import type { FocusPayload } from '@ipc/services/focus/contract'

import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { setIpcServiceErrorLogger } from '@ipc/core/service'
import { focusToRenderer } from '@ipc/services/focus/toRenderer'
import { createShortcutConfigService } from '@ipc/services/shortcut-config/service'
import { startSystemPreferencesListener } from '@ipc/services/system-preferences/service'
import { initAutoUpdater } from '@ipc/services/update/service'
import { cancelVoiceImeSession, registerVoiceImeStartGuard, setVoiceImeTranscriptionDispatcher } from '@ipc/services/voice-ime/service'
import { getVoiceImeForegroundWindowHost } from '@ipc/services/voice-ime/state'
import { voiceImeToRenderer } from '@ipc/services/voice-ime/toRenderer'
import { APP_PROTOCOL, FOCUS_NATIVE_WINDOW_SIZE, WindowType } from '@shared'
import { app, ipcMain, screen, shell } from 'electron'
import icon from '../resources/icon.png?asset'
import { initDeeplink } from './deeplink'
import { hideGlobalToast, setGlobalToastNoticeTargetResolver } from './global-toast'
import { bindGlobalEscapeConsumerToVisibility } from './escape-dismiss'
import { GLOBAL_ESCAPE_PRIORITY } from './global-escape'
import { voiceImeState } from './voice-ime-state'
import { registerMainWindowOpener } from './main-window-opener'
import { attachMainWindowCloseBehavior, initWindowQuitCleanup } from './window-lifecycle'
import { checkFocusedTextInput } from './focus-check'
import { createMainDiagnosticLogger, initAppLogging } from './logging'
import { setupDisplayMediaHandler } from './media/display-media'
import { mediaSessionStore } from './media/session-store'
import { initMeetingDetection } from './meeting-detection'
import { initNativeRecordingPipeline } from './native-recording'
import { initPowerEventCleanup } from './power-events'
import { initPowerSaveBlockers } from './power-save-blocker'
import { isCaptureOverlayOpen, warmScreenshotOverlays } from './screenshot'
import { recordingState } from './recording-state'
import { initSelectionHook } from './selection'
import { attachFnComboSuppression, onShortcutRuntimeSyncRequested, requestShortcutRuntimeSync } from './shortcuts'
import { initTray } from './tray'
import { dispatchTranscription } from './voice-ime-inject'
import { cancelPendingVoiceImeShortcut, handleShortcutAction, reapplyAppShortcutRuntime } from './shortcut-actions'
import { createWindowsSequentially, logicalWindowManager, windowManager } from './window-manager'
import '@ipc/services'

/** Linux: 自动检测 Wayland/X11，避免纯 Wayland 环境（如 Niri）下启动崩溃 */
app.commandLine.appendSwitch('ozone-platform-hint', 'auto')

/** macOS: 启用系统音频回环（loopback）捕获能力 */
// - MacSckSystemAudioLoopbackOverride：强制走 ScreenCaptureKit 回环（macOS 15/26 实测可用，需 video 轨）
// - MacLoopbackAudioForScreenShare：屏幕共享时附带系统音频
/** 配合 getDisplayMedia handler 的 audio:'loopback' 与 Info.plist 的 NSAudioCaptureUsageDescription 生效 */
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch(
    'enable-features',
    'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride',
  )
}

setupHttpCachePolicy()
setupDevParentExitCleanup()
registerMainWindowOpener(showOrCreateMainWindow)

initDeeplink(() => {
  initAppLogging(ipcMain)
  registerVoiceImeStartGuard(() => {
    if (recordingState.isBusy && recordingState.snapshot.phase !== 'paused') return 'recording'
    if (isCaptureOverlayOpen()) return 'capture'
    return null
  })
  setGlobalToastNoticeTargetResolver(getVoiceImeForegroundWindowHost)
  setVoiceImeTranscriptionDispatcher((payload, context) => dispatchTranscription(payload.text, {
    sourceHost: payload.sourceHost,
    sessionId: context.sessionId ?? undefined,
  }))
  const unbindVoiceImeDismissal = bindGlobalEscapeConsumerToVisibility(WindowType.VOICE_IME, {
    id: 'voice-ime-surface',
    priority: GLOBAL_ESCAPE_PRIORITY.surface,
    isActive: () => !voiceImeState.hasSession,
    onEscape: () => {
      const target = windowManager.get(WindowType.VOICE_IME)
      if (target && !target.isDestroyed()) voiceImeToRenderer.emit('dismiss', { reason: 'escape' }, target)
    },
  })
  const unbindToastDismissal = bindGlobalEscapeConsumerToVisibility(WindowType.GLOBAL_TOAST, {
    id: 'global-toast',
    priority: GLOBAL_ESCAPE_PRIORITY.toast,
    onEscape: hideGlobalToast,
  })
  app.once('before-quit', () => {
    unbindVoiceImeDismissal()
    unbindToastDismissal()
  })
  initPowerEventCleanup()
  initPowerSaveBlockers()
  const ipcLog = createMainDiagnosticLogger('ipc.service')
  setIpcServiceErrorLogger((error, meta) => {
    ipcLog.error(`${meta.kind}.failed`, 'IPC handler failed', error, meta)
  })

  setupAppIdentity()
  setupDisplayMediaHandler()
  setupBrowserWindowLifecycle()
  setupAppActivation()
  startSystemPreferencesListener()

  createMainWindow()

  createShortcutConfigService({
    onReapply: requestShortcutRuntimeSync,
    onTrigger: handleShortcutAction,
  })
  onShortcutRuntimeSyncRequested(reapplyAppShortcutRuntime)
  reapplyAppShortcutRuntime()

  initSelectionHook()

  /**
   * 初始化自动更新：桥接 autoUpdater 事件 → IPC，并默认启动后 ~10s 首检、每 4h 轮询
   * 发现新版本会通过 status 事件让渲染端自动弹出更新窗。可传 { pollIntervalMs: 0 } 关闭轮询
   */
  initAutoUpdater()

  if (process.platform === 'darwin') {
    startFocusCheckPolling()
    initMeetingDetection()
    /** 手动 native tap 录音管线（macOS 14.2+ 混入系统音频）：与会议录音共用 audio-recorder 子进程 */
    initNativeRecordingPipeline()
  }
}, showOrCreateMainWindow, {
  /** 自动启动的音频监测与系统时间格式 helper 最低支持 macOS 14.2。 */
  minimumMacOS: { major: 14, minor: 2 },
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

function setupAppIdentity(): void {
  electronApp.setAppUserModelId(`com.${APP_PROTOCOL}`)
}

/**
 * HTTP 磁盘缓存治理。Chromium HTTP 缓存（userData/Cache）默认上限按剩余磁盘
 * 启发式计算、可达数 GB，长期使用会无限膨胀（Chromium 按「完整 URL」做缓存 key，
 * 带易变 query 的资源只写不复用）：
 * - dev：Vite 依赖重优化会给模块 URL 换 `?v=hash`，旧条目永不再命中；
 *   且资源本就来自本机 dev server（内存服务），磁盘缓存零收益 → 整个禁用
 * - prod：封顶 256MB 交给 LRU 淘汰，只设磁盘上限、不改变缓存语义
 *
 * 须在 app ready 前调用：Electron 的 Session 没有 setCacheSize API，只能走命令行开关
 */
function setupHttpCachePolicy(): void {
  if (is.dev) {
    app.commandLine.appendSwitch('disable-http-cache')
    return
  }

  app.commandLine.appendSwitch('disk-cache-size', String(256 * 1024 * 1024))
}

/** dev 父进程存活探测间隔 */
const DEV_PARENT_CHECK_INTERVAL_MS = 2000

/**
 * dev 残留实例回收。electron-vite 以 `stdio: 'inherit'` spawn 本进程，却只在「主进程重建」
 * 时 kill 子进程——Ctrl-C 结束 dev server 时不回收，本进程会变成孤儿：
 * 窗口留在屏幕上（renderer 连的 vite server 已死，悬停即转圈），
 * 更要命的是它占着 requestSingleInstanceLock，下次 dev 起的新实例拿不到锁直接 quit，
 * 表现为 dev 卡在 `starting electron app...` 且永不建窗
 *
 * 两路兜底：
 * - 信号：终端 Ctrl-C 把 SIGINT 发给整个前台进程组，本进程在组内，走这条即可
 * - 轮询 ppid：信号未送达时（dev server 被单独 kill 或自身崩溃）本进程会被 reparent，
 *   ppid 变化即判定父进程已死。注意 stdio 是 'inherit'，stdin 就是终端 TTY 本身、
 *   不会随父进程关闭而 EOF，因此监听 stdin 无效（实测不触发）
 *
 * 走 app.quit() 而非 exit()，以触发既有的 before-quit 销毁窗口、will-quit 停 powerSaveBlocker
 * 与 native helper 清理，避免 helper 子进程反过来变成孤儿
 */
function setupDevParentExitCleanup(): void {
  if (!is.dev) return

  const quitOnce = (): void => {
    process.exitCode = 0
    app.quit()
  }

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, quitOnce)
  }

  const parentPid = process.ppid
  const timer = setInterval(() => {
    if (process.ppid === parentPid) return

    clearInterval(timer)
    quitOnce()
  }, DEV_PARENT_CHECK_INTERVAL_MS)

  /** 不因这个心跳把进程钉在事件循环里，正常退出路径不受影响 */
  timer.unref?.()
}

// ─────────────────────────────────────────────
/** 窗口生命周期 */
// ─────────────────────────────────────────────

function setupBrowserWindowLifecycle(): void {
  app.on('browser-window-created', (_, window) => {
    /**
     * `watchWindowShortcuts` 的 zoom 默认是 false，会在 before-input-event 里对
     * `Cmd/Ctrl + Minus` 和 `Cmd/Ctrl + Shift + Equal` 调 preventDefault
     * preventDefault 让 Electron 直接返回 HANDLED，按键既不下发渲染进程也不触发菜单
     * accelerator，表现为「Cmd+= 能放大、Cmd+0 能恢复，唯独 Cmd+- 无法缩小」
     * （Digit0 和不带 shift 的 Equal 都不在它的拦截列表里）
     * 这里显式放行，把缩放交回 Electron 默认菜单的 zoomIn / zoomOut / resetZoom role
     */
    optimizer.watchWindowShortcuts(window, { zoom: true })

    /** Fn 组合的物理键仍会走到窗口里，聚焦输入框时会多打出 `fn+\`` 的反引号、`fn+Space` 的空格 */
    attachFnComboSuppression(window.webContents)

    const webContentsId = window.webContents?.id

    window.on('closed', () => {
      if (webContentsId) {
        mediaSessionStore.deleteSnapshot(webContentsId)
      }
    })
  })

  app.on('before-quit', () => {
    cancelPendingVoiceImeShortcut()
    cancelVoiceImeSession('window-closed')
  })
  initWindowQuitCleanup()
}

/**
 * Dock 图标点击（activate）恢复主窗口
 *
 * 浮窗均为非激活 panel（macFullscreenAuxiliary），show/hide/点击都不会触发 activate，
 * 因此这里无需区分来源，直接恢复主窗口即可
 */
function setupAppActivation(): void {
  app.on('activate', () => {
    reapplyAppShortcutRuntime()
    showOrCreateMainWindow()
  })
}

/** 主窗口存活则前置显示，已销毁（如 macOS 关闭主窗后）则重建——tray 与 Dock activate 共用 */
function showOrCreateMainWindow(): Electron.BrowserWindow | null {
  const mainWindow = windowManager.get(WindowType.MAIN)
  if (mainWindow && !mainWindow.isDestroyed()) {
    windowManager.show(WindowType.MAIN)
    return mainWindow
  }

  return createMainWindow()
}

function createMainWindow(): Electron.BrowserWindow {
  const mainWindow = windowManager.create(WindowType.MAIN, {
    ...(process.platform === 'darwin'
      ? {
        titleBarStyle: 'hidden' as const,
        trafficLightPosition: { x: 14, y: 14 },
      }
      : {}),
    ...(process.platform === 'linux'
      ? { icon }
      : {}),
  })!

  attachMainWindowCloseBehavior(mainWindow)

  /**
   * 主窗创建即显示（见 PHYSICAL_WINDOW_CONFIGS[MAIN]），首帧由 index.html 内的静态 splash 提供；
   * Electron 只对尚未显示的窗口发 ready-to-show，启动期的一次性初始化改挂 did-finish-load
   */
  mainWindow.webContents.once('did-finish-load', () => {
    /** 主窗口加载完成后串行创建其余窗口，避免启动时多个 Chromium 进程同时初始化 */
    /** SELECTION / SHORTCUT_TEST 按需懒创建，不在此列 */
    initTray({ onOpenMain: showOrCreateMainWindow })
    void createWindowsSequentially([
      { type: WindowType.VOICE_IME },
    ]).then(() => {
      showFocusNativeDemoWindow()
      /** 延迟敏感但不阻塞主窗首屏：排在既有常驻窗之后串行预热截图 renderer */
      return warmScreenshotOverlays()
    })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      if (url.hostname === 'appleid.apple.com') {
        return { action: 'allow' }
      }
      shell.openExternal(details.url)
      return { action: 'deny' }
    }
    catch {
      shell.openExternal(details.url)
      return { action: 'deny' }
    }
  })

  return mainWindow
}

function startFocusCheckPolling(): void {
  let prevKey = ''

  setInterval(async () => {
    if (!logicalWindowManager.isActive(WindowType.FOCUS_NATIVE)) return
    const demo = logicalWindowManager.getTargetWindow(WindowType.FOCUS_NATIVE)
    if (!demo || demo.isDestroyed() || !demo.isVisible()) return

    const result = await checkFocusedTextInput()
    const isSelf = result.pid === process.pid

    const key = `${result.focused}-${result.bundleId ?? ''}-${result.role ?? ''}-${result.pid}`
    if (key === prevKey) return
    prevKey = key

    const payload: FocusPayload = {
      focused: result.focused,
      role: result.role,
      app: result.app,
      bundleId: result.bundleId,
      isSelf,
    }

    layoutFocusNativeDemoWindow(result.focused)
    emitFocusUpdate(payload)
  }, 1500)
}

function emitFocusUpdate(payload: FocusPayload): void {
  for (const type of FOCUS_UPDATE_TARGETS) {
    const win = logicalWindowManager.getTargetWindow(type)
    if (win && !win.isDestroyed()) {
      focusToRenderer.emit('update', payload, win)
    }
  }
}

function showFocusNativeDemoWindow(): void {
  logicalWindowManager.showInactive(WindowType.FOCUS_NATIVE, {
    payload: {
      focused: false,
      role: null,
      app: null,
      bundleId: null,
      isSelf: false,
    } satisfies FocusPayload,
  })
  layoutFocusNativeDemoWindow(false, false, true)
}

function layoutFocusNativeDemoWindow(focused: boolean, animate = true, resetPosition = false): void {
  if (!logicalWindowManager.isActive(WindowType.FOCUS_NATIVE)) return

  const win = logicalWindowManager.getTargetWindow(WindowType.FOCUS_NATIVE)
  if (!win || win.isDestroyed()) {
    return
  }

  const state = focused
    ? 'focused'
    : 'idle'
  const previousState = focusNativeLastFocused
    ? 'focused'
    : 'idle'
  const windowSize = FOCUS_NATIVE_WINDOW_SIZE[state]
  const previousWindowSize = FOCUS_NATIVE_WINDOW_SIZE[previousState]
  const displayArea = screen.getPrimaryDisplay().workArea
  const currentBounds = win.getBounds()
  const right = resetPosition
    ? displayArea.x + displayArea.width - FOCUS_NATIVE_MARGIN
    : currentBounds.x + previousWindowSize.width
  const bottom = resetPosition
    ? displayArea.y + displayArea.height - FOCUS_NATIVE_MARGIN
    : currentBounds.y + previousWindowSize.height

  logicalWindowManager.setBounds(WindowType.FOCUS_NATIVE, {
    x: Math.round(right - windowSize.width),
    y: Math.round(bottom - windowSize.height),
    width: windowSize.width,
    height: windowSize.height,
  }, animate)

  focusNativeLastFocused = focused
}

const FOCUS_UPDATE_TARGETS = [
  WindowType.FOCUS_NATIVE,
] as const

const FOCUS_NATIVE_MARGIN = 20
let focusNativeLastFocused = false

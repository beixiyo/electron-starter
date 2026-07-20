import type { FocusPayload } from '@ipc/services/focus/contract'
import type { VoiceImeReleaseResult, VoiceImeRendererStatusPayload } from '@shared'
import type { ShortcutRuntimeEvent } from '@shared/shortcuts'
import type { ShortcutRuntimeHandlers } from './shortcuts'

import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { setIpcServiceErrorLogger } from '@ipc/core/service'
import { focusService } from '@ipc/services/focus/service'
import { sendHoldEndEvent, sendHoldStartEvent } from '@ipc/services/hold/service'
import { createShortcutConfigService } from '@ipc/services/shortcut-config/service'
import { initAutoUpdater } from '@ipc/services/update/service'
import { voiceImeService } from '@ipc/services/voice-ime/service'
import {
  APP_PROTOCOL,
  FOCUS_NATIVE_WINDOW_SIZE,
  HOLD_MIN_DURATION_MS,
  HOLD_SHORT_ERROR_MESSAGE,
  WindowType,
} from '@shared'
import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import icon from '../resources/icon.png?asset'
import { initDeeplink } from './deeplink'
import { checkFocusedTextInput } from './focus-check'
import { createMainDiagnosticLogger, initAppLogging } from './logging'
import { setupDisplayMediaHandler } from './media/display-media'
import { mediaSessionStore } from './media/session-store'
import { initMeetingDetection } from './meeting-detection'
import { initNativeRecordingPipeline } from './native-recording'
import { setupOAuthInterceptor } from './oauth-interceptor'
import { ensureMicrophonePermissionOrExplain } from './permission-required'
import { initPowerSaveBlockers } from './power-save-blocker'
import { startCaptureFromShortcut } from './screenshot'
import { initSelectionHook } from './selection'
import {
  holdStateManager,
  onShortcutRuntimeSyncRequested,
  reapplyShortcutRuntime,
  setupFnKeyIpc,
} from './shortcuts'
import { readShortcutBindings } from './store/shortcut-bindings'
import { initTray } from './tray'
import { pasteText } from './utils'
import { createWindowsSequentially, getShortcutTestWindowBounds, logicalWindowManager, windowManager } from './window-manager'
import '@ipc/services'

// Linux: 自动检测 Wayland/X11，避免纯 Wayland 环境（如 Niri）下启动崩溃
app.commandLine.appendSwitch('ozone-platform-hint', 'auto')

// macOS: 启用系统音频回环（loopback）捕获能力
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

initDeeplink(() => {
  initAppLogging(ipcMain)
  initPowerSaveBlockers()
  const ipcLog = createMainDiagnosticLogger('ipc.service')
  setIpcServiceErrorLogger((error, meta) => {
    ipcLog.error('invoke.failed', 'IPC handler failed', error, meta)
  })

  setupAppIdentity()
  setupDisplayMediaHandler()
  setupBrowserWindowLifecycle()
  setupAppActivation()

  createMainWindow()

  reapplyAppShortcutRuntime()
  createShortcutConfigService((bindings) => {
    reapplyShortcutRuntime(bindings, SHORTCUT_ACTION_HANDLERS)
  })
  onShortcutRuntimeSyncRequested(reapplyAppShortcutRuntime)

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
  if (!is.dev)
    return

  const quitOnce = (): void => {
    process.exitCode = 0
    app.quit()
  }

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, quitOnce)
  }

  const parentPid = process.ppid
  const timer = setInterval(() => {
    if (process.ppid === parentPid)
      return

    clearInterval(timer)
    quitOnce()
  }, DEV_PARENT_CHECK_INTERVAL_MS)

  /** 不因这个心跳把进程钉在事件循环里，正常退出路径不受影响 */
  timer.unref?.()
}

// ─────────────────────────────────────────────
// Voice IME 共用逻辑
// ─────────────────────────────────────────────

function sendVoiceImeStatus(payload: VoiceImeRendererStatusPayload): void {
  const win = windowManager.get(WindowType.VOICE_IME)
  if (win && !win.isDestroyed()) {
    voiceImeService.emit('status', payload, win)
  }
}

/** 延迟隐藏 Voice IME 的定时器句柄，防止旧定时器把下一轮正在录音的窗口藏掉 */
let voiceImeHideTimer: ReturnType<typeof setTimeout> | null = null

function clearVoiceImeHideTimer(): void {
  if (voiceImeHideTimer) {
    clearTimeout(voiceImeHideTimer)
    voiceImeHideTimer = null
  }
}

function hideVoiceImeLater(delayMs: number): void {
  clearVoiceImeHideTimer()
  voiceImeHideTimer = setTimeout(() => {
    voiceImeHideTimer = null
    /** 延迟期间用户可能再次长按开始了新录音，此时不能隐藏 */
    if (!holdStateManager.isHolding(WindowType.VOICE_IME)) {
      windowManager.hide(WindowType.VOICE_IME)
    }
  }, delayMs)
}

async function handleVoiceImeRelease(raw: unknown): Promise<void> {
  const result = raw as VoiceImeReleaseResult
  clearVoiceImeHideTimer()

  if ('error' in result) {
    const isShortHold = result.error === HOLD_SHORT_ERROR_MESSAGE
    sendVoiceImeStatus({
      status: 'idle',
      error: isShortHold
        ? HOLD_SHORT_ERROR_MESSAGE
        : result.error,
    })

    if (isShortHold) {
      /** 短按错误提示停留 1s 再隐藏 */
      hideVoiceImeLater(1000)
    }
    else {
      windowManager.hide(WindowType.VOICE_IME)
    }
    return
  }

  sendVoiceImeStatus({ status: 'processing', error: null })
  windowManager.hide(WindowType.VOICE_IME)

  const mockText = '[Test] Voice IME — 这是模拟语音识别结果'
  await pasteText(mockText)
}

// ─────────────────────────────────────────────
// Focus Demo / Shortcut Test — 通过 contract service 发送事件
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
/** 窗口生命周期 */
// ─────────────────────────────────────────────

function setupBrowserWindowLifecycle(): void {
  app.on('browser-window-created', (_, window) => {
    /**
     * `watchWindowShortcuts` 的 zoom 默认是 false，会在 before-input-event 里对
     * `Cmd/Ctrl + Minus` 和 `Cmd/Ctrl + Shift + Equal` 调 preventDefault。
     * preventDefault 让 Electron 直接返回 HANDLED，按键既不下发渲染进程也不触发菜单
     * accelerator，表现为「Cmd+= 能放大、Cmd+0 能恢复，唯独 Cmd+- 无法缩小」
     * （Digit0 和不带 shift 的 Equal 都不在它的拦截列表里）。
     * 这里显式放行，把缩放交回 Electron 默认菜单的 zoomIn / zoomOut / resetZoom role
     */
    optimizer.watchWindowShortcuts(window, { zoom: true })

    const webContentsId = window.webContents?.id

    window.on('closed', () => {
      if (webContentsId) {
        mediaSessionStore.deleteSnapshot(webContentsId)
      }
    })
  })

  app.on('before-quit', () => {
    const windows = windowManager.getAll()
    windows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.destroy()
      }
    })
  })
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
function showOrCreateMainWindow(): void {
  const mainWindow = windowManager.get(WindowType.MAIN)
  if (mainWindow && !mainWindow.isDestroyed()) {
    windowManager.show(WindowType.MAIN)
    return
  }

  createMainWindow()
}

function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 308,
    height: 208,
    frame: false,
    transparent: true,
    hasShadow: false,
    roundedCorners: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    center: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    splash.loadURL(`${process.env.ELECTRON_RENDERER_URL}/windows/splash/index.html`)
  }
  else {
    splash.loadFile(join(app.getAppPath(), 'out', 'renderer', 'windows', 'splash', 'index.html'))
  }

  return splash
}

function createMainWindow(): void {
  const splash = createSplashWindow()

  /**
   * splash 兜底销毁：正常路径是主窗 ready-to-show，但主窗加载失败/渲染进程崩溃/先被关闭时
   * ready-to-show 永不触发，置顶透明 splash 及其渲染进程会永活。三路兜底共用此幂等销毁
   */
  const destroySplash = (): void => {
    clearTimeout(splashFallbackTimer)
    if (!splash.isDestroyed())
      splash.destroy()
  }

  /** 渲染进程挂死等一切未覆盖异常路径的最后兜底 */
  const splashFallbackTimer = setTimeout(destroySplash, 15_000)

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

  if (process.platform === 'darwin') {
    setupFnKeyIpc(mainWindow)
  }

  setupOAuthInterceptor(mainWindow)

  /** 主窗先于 ready-to-show 被关闭（启动即退出/崩溃销毁）时回收 splash */
  mainWindow.on('closed', destroySplash)

  /** 主框架加载失败后不再有 ready-to-show；-3（ERR_ABORTED，如导航中断/重试）不算失败，等后续加载 */
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, _errorDescription, _validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3)
      destroySplash()
  })

  mainWindow.once('ready-to-show', () => {
    destroySplash()
    mainWindow.show()

    /** 主窗口显示后串行创建其余窗口，避免启动时多个 Chromium 进程同时初始化 */
    // SELECTION / SHORTCUT_TEST 按需懒创建，不在此列
    initTray({ onOpenMain: showOrCreateMainWindow })
    void createWindowsSequentially([
      { type: WindowType.VOICE_IME },
    ]).then(showFocusNativeDemoWindow)
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
}

/**
 * 快捷键 runtime
 */

function reapplyAppShortcutRuntime(): void {
  reapplyShortcutRuntime(readShortcutBindings(), SHORTCUT_ACTION_HANDLERS)
}

function showShortcutTestWindow(
  label: string,
  triggerType: 'combo' | 'doublePress' | 'hold' | 'hotkey',
): void {
  logicalWindowManager.show(WindowType.SHORTCUT_TEST, {
    payload: { triggerType, label },
    bounds: getShortcutTestWindowBounds(),
  })
}

/** hotkey 绑定的触发处理器，按 action id 索引 */
const SHORTCUT_ACTION_HANDLERS: ShortcutRuntimeHandlers = {
  recording: handleShortcutAction,
  askAssistant: handleShortcutAction,
  voiceDictation: handleShortcutAction,
  bookmark: handleShortcutAction,
  screenshot: handleShortcutAction,
}

function handleShortcutAction(event: ShortcutRuntimeEvent): void {
  switch (event.id) {
    case 'recording':
      showShortcutActionTestWindow('Recording', event)
      return
    case 'askAssistant':
      showShortcutActionTestWindow('Ask', event)
      return
    case 'voiceDictation':
      handleVoiceDictationShortcut(event)
      return
    case 'bookmark':
      showShortcutActionTestWindow('Bookmark', event)
      return
    case 'screenshot':
      handleScreenshotShortcut(event)
      return
  }
}

function showShortcutActionTestWindow(label: string, event: ShortcutRuntimeEvent): void {
  if (event.phase !== 'trigger')
    return

  const { gesture } = event
  showShortcutTestWindow(
    `${label} (${formatKeyboardGestureLabel(gesture)})`,
    getShortcutTestTriggerType(event),
  )
}

function handleScreenshotShortcut(event: ShortcutRuntimeEvent): void {
  if (event.phase !== 'trigger')
    return

  void startCaptureFromShortcut()
}

function formatKeyboardGestureLabel(gesture: ShortcutRuntimeEvent['gesture']): string {
  switch (gesture) {
    case 'press':
      return 'hotkey'
    case 'doublePress':
      return 'double hotkey'
    case 'hold':
      return 'hold hotkey'
  }
}

function getShortcutTestTriggerType(event: ShortcutRuntimeEvent): 'combo' | 'doublePress' | 'hold' | 'hotkey' {
  if (event.gesture === 'doublePress')
    return 'doublePress'
  if (event.gesture === 'hold')
    return 'hold'
  if (event.binding.chord.source === 'fn' && event.binding.chord.key !== 'Fn')
    return 'combo'
  return 'hotkey'
}

function handleVoiceDictationShortcut(event: ShortcutRuntimeEvent): void {
  if (event.gesture !== 'hold') {
    showShortcutActionTestWindow('Voice Dictation', event)
    return
  }

  if (event.phase === 'trigger') {
    keyboardVoiceImeHoldActive = true
    void startVoiceImeKeyboardHold()
    return
  }

  keyboardVoiceImeHoldActive = false
  finishVoiceImeKeyboardHold()
}

async function startVoiceImeKeyboardHold(): Promise<void> {
  if (holdStateManager.isHolding(WindowType.VOICE_IME))
    return

  if (!(ensureMicrophonePermissionOrExplain('voice-ime'))) {
    keyboardVoiceImeHoldActive = false
    return
  }

  if (!keyboardVoiceImeHoldActive)
    return

  holdStateManager.startHold({
    type: WindowType.VOICE_IME,
    onRelease: handleVoiceImeRelease,
  })

  const win = windowManager.get(WindowType.VOICE_IME) || windowManager.create(WindowType.VOICE_IME)
  if (win && !win.isVisible()) {
    const config = windowManager.getMetadata(WindowType.VOICE_IME)?.config
    if (config?.focusable) {
      windowManager.show(WindowType.VOICE_IME)
    }
    else {
      windowManager.showInactive(WindowType.VOICE_IME)
    }
  }

  sendHoldStartEvent(WindowType.VOICE_IME)
}

function finishVoiceImeKeyboardHold(): void {
  const holdState = holdStateManager.getHoldState(WindowType.VOICE_IME)
  if (!holdState || !holdState.isHolding)
    return

  const holdDuration = Date.now() - holdState.startTime
  if (holdDuration < HOLD_MIN_DURATION_MS) {
    holdStateManager.completeHold(WindowType.VOICE_IME, {
      error: HOLD_SHORT_ERROR_MESSAGE,
      duration: Math.max(holdDuration, 0),
    })
  }

  sendHoldEndEvent(WindowType.VOICE_IME)
}

/** keyboard hold 的本地按下态；防止权限检查 await 期间用户已松开但之后又启动录音 */
let keyboardVoiceImeHoldActive = false

function startFocusCheckPolling(): void {
  let prevKey = ''

  setInterval(async () => {
    const result = await checkFocusedTextInput()
    const isSelf = result.pid === process.pid

    const key = `${result.focused}-${result.bundleId ?? ''}-${result.role ?? ''}-${result.pid}`
    if (key === prevKey)
      return
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

    if (isSelf) {
      console.log(`[focus-check] 🏠 self  focused=${result.focused}  role=${result.role}`)
    }
    else if (result.focused) {
      console.log(`[focus-check] ✅ focused  role=${result.role}  app=${result.app}  bundleId=${result.bundleId}`)
    }
  }, 1500)
}

function emitFocusUpdate(payload: FocusPayload): void {
  for (const type of FOCUS_UPDATE_TARGETS) {
    const win = logicalWindowManager.getTargetWindow(type)
    if (win && !win.isDestroyed()) {
      focusService.emit('update', payload, win)
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
  if (!logicalWindowManager.isActive(WindowType.FOCUS_NATIVE))
    return

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

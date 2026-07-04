import type { FocusPayload } from '@ipc/services/focus/contract'
import type { ShortcutBindings } from '@ipc/services/shortcut-config/contract'
import type { VoiceImeReleaseResult, VoiceImeRendererStatusPayload } from '@shared'

import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { focusService } from '@ipc/services/focus/service'
import { createShortcutConfigService } from '@ipc/services/shortcut-config/service'
import { initAutoUpdater } from '@ipc/services/update/service'
import { voiceImeService } from '@ipc/services/voice-ime/service'
import {
  APP_PROTOCOL,
  FOCUS_NATIVE_WINDOW_SIZE,
  HOLD_SHORT_ERROR_MESSAGE,
  SHORTCUTS,
  WindowType,
} from '@shared'
import { app, BrowserWindow, screen, shell } from 'electron'
import icon from '../resources/icon.png?asset'
import { initDeeplink } from './deeplink'
import { checkFocusedTextInput } from './focus-check'
import { holdStateManager, registerFnShortcuts, registerHoldGlobalShortcut, registerHotkeyShortcuts, resetShortcutHandlers, setupFnKeyIpc, startFnKeyListener, unregisterHotkeyShortcuts } from './keyboard'
import { setupDisplayMediaHandler } from './media/display-media'
import { mediaSessionStore } from './media/session-store'
import { initMeetingDetection } from './meeting-detection'
import { initNativeRecordingPipeline } from './native-recording'
import { setupOAuthInterceptor } from './oauth-interceptor'
import { ensureMicrophonePermissionOrExplain } from './permission-required'
import { registerScreenshotShortcut } from './screenshot'
import { initSelectionHook } from './selection'
import { readShortcutBindings } from './store/shortcut-bindings'
import { initTray } from './tray'
import { pasteText } from './utils'
import { createWindowsSequentially, logicalWindowManager, windowManager } from './window-manager'
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

initDeeplink(() => {
  setupAppIdentity()
  setupDisplayMediaHandler()
  setupVoiceImeHoldShortcut()
  setupBrowserWindowLifecycle()
  setupAppActivation()

  createMainWindow()

  const initialBindings = readShortcutBindings()
  setupFnKeyShortcuts(initialBindings)
  registerHotkeyShortcuts(initialBindings, HOTKEY_HANDLERS)
  createShortcutConfigService((bindings) => {
    resetShortcutHandlers()
    unregisterHotkeyShortcuts()
    setupFnKeyShortcuts(bindings)
    registerHotkeyShortcuts(bindings, HOTKEY_HANDLERS)
  })

  initSelectionHook()
  registerScreenshotShortcut(SHORTCUTS.SCREENSHOT.accelerator)

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
// Cmd+E 长按快捷键
// ─────────────────────────────────────────────

function setupVoiceImeHoldShortcut(): void {
  registerHoldGlobalShortcut({
    accelerator: SHORTCUTS.HOLD_VOICE_IME.accelerator,
    windowType: SHORTCUTS.HOLD_VOICE_IME.windowType,
    canStart: () => ensureMicrophonePermissionOrExplain('voice-ime'),
    onRelease: handleVoiceImeRelease,
  })
}

// ─────────────────────────────────────────────
// Focus Demo / Shortcut Test — 通过 contract service 发送事件
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
/** 窗口生命周期 */
// ─────────────────────────────────────────────

function setupBrowserWindowLifecycle(): void {
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)

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

  const mainWindow = windowManager.create(WindowType.MAIN, {
    ...(process.platform === 'linux'
      ? { icon }
      : {}),
  })!

  if (process.platform === 'darwin') {
    startFnKeyListener()
    setupFnKeyIpc(mainWindow)
  }

  setupOAuthInterceptor(mainWindow)

  mainWindow.once('ready-to-show', () => {
    splash.destroy()
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

// ─────────────────────────────────────────────
// Fn 键状态机快捷键
// ─────────────────────────────────────────────

function showShortcutTestWindow(
  label: string,
  triggerType: 'combo' | 'doublePress' | 'hold' | 'hotkey',
): void {
  logicalWindowManager.show(WindowType.SHORTCUT_TEST, {
    payload: { triggerType, label },
  })
}

/** hotkey 绑定的触发处理器，按 action id 索引 */
const HOTKEY_HANDLERS: Record<string, () => void> = {
  recording: () => showShortcutTestWindow('Recording (hotkey)', 'hotkey'),
  askAssistant: () => showShortcutTestWindow('Ask (hotkey)', 'hotkey'),
  bookmark: () => showShortcutTestWindow('Bookmark (hotkey)', 'hotkey'),
}

function setupFnKeyShortcuts(bindings: ShortcutBindings): void {
  if (process.platform !== 'darwin')
    return

  /** 收集所有 combo 类型绑定，含修饰符信息 */
  const combos = Object.entries(bindings).flatMap(([id, b]) => {
    if (b?.type !== 'combo')
      return []
    const { key, modifiers } = b
    return [{
      key,
      modifiers,
      onTrigger: () => {
        console.log(`[fn:combo] ✅ Fn+${key} → ${id}`)
        showShortcutTestWindow(`Fn + ${key}`, 'combo')
      },
    }]
  })

  registerFnShortcuts({
    hold: bindings.voiceDictation?.type === 'hold'
      ? {
          windowType: WindowType.VOICE_IME,
          canStart: () => ensureMicrophonePermissionOrExplain('voice-ime'),
          onRelease: handleVoiceImeRelease,
        }
      : undefined,

    doublePress: bindings.askAssistant?.type === 'doublePress'
      ? {
          onTrigger: () => {
            console.log('[fn:double] ✅ 双击触发')
            showShortcutTestWindow('Ask (double fn)', 'doublePress')
          },
        }
      : undefined,

    combos,
  })
}

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

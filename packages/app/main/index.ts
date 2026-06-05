import type { ShortcutBindings } from '@ipc/services/shortcut-config/contract'
import type { VoiceImeReleaseResult, VoiceImeRendererStatusPayload } from '@shared'

import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { focusDemoService } from '@ipc/services/focus-demo/service'
import { createShortcutConfigService } from '@ipc/services/shortcut-config/service'
import { shortcutTestService } from '@ipc/services/shortcut-test/service'
import { voiceImeService } from '@ipc/services/voice-ime/service'
import {
  APP_PROTOCOL,
  HOLD_SHORT_ERROR_MESSAGE,
  SHORTCUTS,
  WindowType,
} from '@shared'
import { app, BrowserWindow, shell } from 'electron'
import icon from '../resources/icon.png?asset'
import { initDeeplink } from './deeplink'
import { registerFnShortcuts, resetShortcutHandlers, setupFnKeyIpc, startFnKeyListener } from './keyboard'
import { checkFocusedTextInput } from './focus-check'
import { registerHotkeyShortcuts, unregisterHotkeyShortcuts } from './keyboard'
import { setupDisplayMediaHandler } from './media/display-media'
import { mediaSessionStore } from './media/session-store'
import { initMeetingDetection } from './meeting-detection'
import { setupOAuthInterceptor } from './oauth-interceptor'
import { registerScreenshotShortcut } from './screenshot'
import { initSelectionHook } from './selection'
import { registerHoldGlobalShortcut } from './keyboard'
import { readShortcutBindings } from './store/shortcut-bindings'
import { initTray } from './tray'
import { pasteText } from './utils'
import { createWindowsSequentially, windowManager } from './window-manager'
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

  if (process.platform === 'darwin') {
    startFocusCheckPolling()
    initMeetingDetection()
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

async function handleVoiceImeRelease(raw: unknown): Promise<void> {
  const result = raw as VoiceImeReleaseResult

  if ('error' in result) {
    const isShortHold = result.error === HOLD_SHORT_ERROR_MESSAGE
    sendVoiceImeStatus({
      status: 'idle',
      error: isShortHold
        ? HOLD_SHORT_ERROR_MESSAGE
        : result.error,
    })

    if (isShortHold) {
      setTimeout(() => windowManager.hide(WindowType.VOICE_IME), 1000)
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

function setupAppActivation(): void {
  app.on('activate', () => {
    const mainWindow = windowManager.get(WindowType.MAIN)
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow()
    }
  })
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
    createWindowsSequentially([
      { type: WindowType.VOICE_IME },
      { type: WindowType.MENUBAR, onLoaded: () => initTray() },
      { type: WindowType.FOCUS_DEMO, onLoaded: win => win.showInactive() },
    ])
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
  if (!windowManager.exists(WindowType.SHORTCUT_TEST))
    windowManager.create(WindowType.SHORTCUT_TEST)
  windowManager.show(WindowType.SHORTCUT_TEST)
  shortcutTestService.emit(
    'trigger',
    { triggerType, label },
    windowManager.get(WindowType.SHORTCUT_TEST)!,
  )
}

/** hotkey 绑定的触发处理器，按 action id 索引 */
const HOTKEY_HANDLERS: Record<string, () => void> = {
  recording: () => showShortcutTestWindow('Recording (hotkey)', 'hotkey'),
  askFlowtica: () => showShortcutTestWindow('Ask (hotkey)', 'hotkey'),
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
      ? { windowType: WindowType.VOICE_IME, onRelease: handleVoiceImeRelease }
      : undefined,

    doublePress: bindings.askFlowtica?.type === 'doublePress'
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

    focusDemoService.emit('update', {
      focused: result.focused,
      role: result.role,
      app: result.app,
      bundleId: result.bundleId,
      isSelf,
    }, windowManager.get(WindowType.FOCUS_DEMO)!)

    if (isSelf) {
      console.log(`[focus-check] 🏠 self  focused=${result.focused}  role=${result.role}`)
    }
    else if (result.focused) {
      console.log(`[focus-check] ✅ focused  role=${result.role}  app=${result.app}  bundleId=${result.bundleId}`)
    }
  }, 1500)
}

import type { FocusDemoPayload, VoiceImeReleaseResult, VoiceImeRendererStatusPayload } from '@shared'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerAllIpcHandlers } from '@ipc/register'
import {
  APP_PROTOCOL,
  FOCUS_DEMO_CHANNEL,
  HOLD_SHORT_ERROR_MESSAGE,
  SHORTCUT_TEST_CHANNEL,
  SHORTCUTS,
  VOICE_IME_RENDERER_CHANNEL,
  WindowType,
} from '@shared'
import { app, shell } from 'electron'
import icon from '../resources/icon.png?asset'
import { initDeeplink } from './deeplink'
import { addFnKeyListener, registerFnShortcuts, setupFnKeyIpc, startFnKeyListener } from './fn-listener'
import { checkFocusedTextInput } from './focus-check'
import { mediaSessionStore } from './media/session-store'
import { setupOAuthInterceptor } from './oauth-interceptor'
import { initScreenshot, registerScreenshotShortcut } from './screenshot'
import { initSelectionHook } from './selection'
import { registerHoldGlobalShortcut } from './shortcuts'
import { pasteText } from './utils'
import { windowManager } from './window-manager'

initDeeplink(() => {
  setupAppIdentity()
  registerAllIpcHandlers()
  setupVoiceImeHoldShortcut()
  setupBrowserWindowLifecycle()
  setupAppActivation()

  createMainWindow()
  setupFnKeyShortcuts()
  initSelectionHook()
  initScreenshot()
  registerScreenshotShortcut(SHORTCUTS.SCREENSHOT.accelerator)

  if (process.platform === 'darwin') {
    startFocusCheckPolling()
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
    win.webContents.send(VOICE_IME_RENDERER_CHANNEL.STATUS, payload)
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
// Focus Demo 面板
// ─────────────────────────────────────────────

function sendFocusDemoUpdate(payload: FocusDemoPayload): void {
  const win = windowManager.get(WindowType.FOCUS_DEMO)
  if (win && !win.isDestroyed()) {
    win.webContents.send(FOCUS_DEMO_CHANNEL.UPDATE, payload)
  }
}

// ─────────────────────────────────────────────
// Shortcut Test 面板
// ─────────────────────────────────────────────

function sendShortcutTestTrigger(triggerType: 'hold' | 'doublePress' | 'combo', label: string): void {
  const win = windowManager.get(WindowType.SHORTCUT_TEST)
  if (!win || win.isDestroyed())
    return
  win.webContents.send(SHORTCUT_TEST_CHANNEL.TRIGGER, { triggerType, label })
}

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

function createMainWindow(): void {
  const mainWindow = windowManager.create(WindowType.MAIN, {
    ...(process.platform === 'linux'
      ? { icon }
      : {}),
  })!
  windowManager.create(WindowType.VOICE_IME)
  windowManager.create(WindowType.SELECTION)
  windowManager.create(WindowType.SHORTCUT_TEST)

  const focusDemoWin = windowManager.create(WindowType.FOCUS_DEMO)
  focusDemoWin?.once('ready-to-show', () => focusDemoWin.showInactive())

  if (process.platform === 'darwin') {
    startFnKeyListener()
    setupFnKeyIpc(mainWindow)
  }

  setupOAuthInterceptor(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)

      const isOAuthDomain = url.hostname === 'appleid.apple.com'
      if (isOAuthDomain) {
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

function setupFnKeyShortcuts(): void {
  if (process.platform !== 'darwin')
    return

  addFnKeyListener(event =>
    console.log(`[fn:raw] ${event === 'down'
      ? '⬇ DOWN'
      : '⬆ UP'}`),
  )

  registerFnShortcuts({
    hold: {
      windowType: WindowType.VOICE_IME,
      onRelease: handleVoiceImeRelease,
    },

    doublePress: {
      onTrigger: () => {
        console.log('[fn:double] ✅ 双击触发')
        if (!windowManager.exists(WindowType.SHORTCUT_TEST)) {
          windowManager.create(WindowType.SHORTCUT_TEST)
        }
        windowManager.show(WindowType.SHORTCUT_TEST)
        sendShortcutTestTrigger('doublePress', 'Double Press Triggered')
      },
    },

    combos: [
      {
        key: 'Space',
        onTrigger: () => {
          console.log('[fn:combo] ✅ Fn+Space 触发')
          if (!windowManager.exists(WindowType.SHORTCUT_TEST)) {
            windowManager.create(WindowType.SHORTCUT_TEST)
          }
          windowManager.show(WindowType.SHORTCUT_TEST)
          sendShortcutTestTrigger('combo', 'Fn + Space')
        },
      },
    ],
  })
}

function startFocusCheckPolling(): void {
  let prevKey = ''

  setInterval(async () => {
    const result = await checkFocusedTextInput()
    const isSelf = result.pid === process.pid

    const key = `${result.focused}-${result.bundleId ?? ''}-${result.role ?? ''}-${result.pid}`
    if (key !== prevKey) {
      prevKey = key
      sendFocusDemoUpdate({
        focused: result.focused,
        role: result.role,
        app: result.app,
        bundleId: result.bundleId,
        isSelf,
      })
    }

    if (isSelf) {
      console.log(`[focus-check] 🏠 self  focused=${result.focused}  role=${result.role}`)
    }
    else if (result.focused) {
      console.log(`[focus-check] ✅ focused  role=${result.role}  app=${result.app}  bundleId=${result.bundleId}`)
    }
  }, 1500)
}

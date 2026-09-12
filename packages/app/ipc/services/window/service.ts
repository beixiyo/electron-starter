import type { WindowBounds, WindowConfig } from '@shared'
import type { WindowContract } from './contract'
import { createIpcService } from '@ipc/core'
import { isDevToolsEnabled } from '@main/devtools'
import { holdStateManager } from '@main/shortcuts'
import { getShortcutTestWindowBounds, logicalWindowManager, windowManager } from '@main/window-manager'
import { resolveAlwaysOnTopLevel, WindowType } from '@shared'
import { BrowserWindow, shell } from 'electron'

/** 只还原本服务确实降低过层级的窗口，销毁后自动释放记录 */
const imeReleasedWindows = new WeakMap<BrowserWindow, () => void>()

export const windowService = createIpcService<WindowContract>('window', {
  mainHandle: {
    create: async (_event, type: WindowType, configOverride?: Partial<WindowConfig>) => {
      try {
        if (type === WindowType.OAUTH) {
          return {
            success: false,
            error: 'OAuth windows must be opened through openOAuth',
          }
        }

        const window = logicalWindowManager.create(type, { configOverride })
        return {
          success: true,
          windowId: window?.id,
        }
      }
      catch (error) {
        console.error(`创建窗口失败 [${type}]:`, error)
        return {
          success: false,
          error: error instanceof Error
            ? error.message
            : 'Unknown error',
        }
      }
    },

    openOAuth: async (_event, url: string) => {
      try {
        if (!isAllowedOAuthUrl(url)) {
          return {
            success: false,
            error: 'Invalid OAuth URL',
          }
        }

        windowManager.destroy(WindowType.OAUTH)
        const window = windowManager.create(WindowType.OAUTH, {
          initialUrl: url,
        })

        return {
          success: true,
          windowId: window?.id,
        }
      }
      catch (error) {
        console.error('打开 OAuth 窗口失败:', error)
        return {
          success: false,
          error: error instanceof Error
            ? error.message
            : 'Unknown error',
        }
      }
    },

    openExternal: async (event, url: string) => {
      try {
        assertMainWindowSender(event)
        if (!isAllowedOAuthUrl(url)) {
          return {
            success: false,
            error: 'Invalid OAuth URL',
          }
        }

        await shell.openExternal(url)
        return { success: true }
      }
      catch (error) {
        return {
          success: false,
          error: error instanceof Error
            ? error.message
            : 'Unknown error',
        }
      }
    },

    /**
     * show/toggle 的非池分支不下沉进 logicalWindowManager：
     * manager.show 对独占窗口会隐式 create，而这里的 IPC 语义是「仅对已存在窗口生效」，
     * 避免 renderer 一次 show(MAIN) 就绕过 createMainWindow 的完整接线裸建主窗
     */
    show: async (_event, type: WindowType) => {
      const success = logicalWindowManager.isPooled(type)
        ? logicalWindowManager.show(type, getLogicalWindowShowOptions(type)) !== null
        : windowManager.show(type)
      return { success }
    },

    hide: async (_event, type: WindowType) => {
      const success = logicalWindowManager.hide(type)
      return { success }
    },

    toggle: async (_event, type: WindowType) => {
      const visible = logicalWindowManager.isPooled(type)
        ? logicalWindowManager.toggle(type)
        : windowManager.toggle(type)
      return { success: true, visible }
    },

    destroy: async (_event, type: WindowType) => {
      const success = logicalWindowManager.destroy(type)
      return { success }
    },

    /** 池化逻辑窗口只能释放自己的占用，不能关闭供其他角色复用的物理窗口 */
    close: async (_event, type) => ({
      success: logicalWindowManager.isPooled(type)
        ? logicalWindowManager.hide(type)
        : windowManager.close(type),
    }),

    minimize: async (_event, type) => ({ success: !!logicalWindowManager.getTargetWindow(type) && windowManager.minimize(logicalWindowManager.resolvePhysicalType(type)) }),

    toggleFullScreen: async (_event, type) => ({ success: !!logicalWindowManager.getTargetWindow(type) && windowManager.toggleFullScreen(logicalWindowManager.resolvePhysicalType(type)) }),

    whenReady: async (_event, type) => ({ success: await windowManager.whenReady(logicalWindowManager.resolvePhysicalType(type)) }),

    setWindowButtonVisibility: async (event, visible) => {
      const win = BrowserWindow.fromWebContents((event as Electron.IpcMainInvokeEvent).sender)
      if (process.platform !== 'darwin' || !win || win.isDestroyed())
        return { success: false }
      win.setWindowButtonVisibility(visible)
      return { success: true }
    },

    setImeComposing: async (event, composing) => {
      const win = BrowserWindow.fromWebContents((event as Electron.IpcMainInvokeEvent).sender)
      if (process.platform !== 'darwin' || !win || win.isDestroyed())
        return { success: false }
      if (composing && win.isAlwaysOnTop() && !imeReleasedWindows.has(win)) {
        win.setAlwaysOnTop(false)
        const restore = () => restoreImeWindowLevel(win)
        imeReleasedWindows.set(win, restore)
        win.once('blur', restore)
        win.once('closed', restore)
      }
      else if (!composing) {
        restoreImeWindowLevel(win)
      }
      return { success: true }
    },

    openDevTools: async (event) => {
      const sender = (event as Electron.IpcMainInvokeEvent).sender
      if (!isDevToolsEnabled() || sender.isDestroyed())
        return { success: false }
      sender.openDevTools({ mode: 'detach' })
      return { success: true }
    },

    isVisible: async (_event, type: WindowType) => {
      const visible = logicalWindowManager.isVisible(type)
      return { visible }
    },

    exists: async (_event, type: WindowType) => {
      const exists = logicalWindowManager.exists(type)
      return { exists }
    },

    getMetadata: async (_event, type: WindowType) => {
      const metadata = windowManager.getMetadata(logicalWindowManager.resolvePhysicalType(type))
      return { metadata }
    },

    getAllTypes: async () => {
      const types = windowManager.getAllTypes()
      return { types }
    },

    release: async (_event, type: WindowType | undefined, result?: unknown) => {
      const holdState = holdStateManager.getHoldState(type)
      if (holdState && holdState.isHolding) {
        holdStateManager.completeHold(type, result)
      }
      return { success: true }
    },

    isHolding: async (_event, type: WindowType | undefined) => {
      const isHolding = holdStateManager.isHolding(type)
      return { isHolding }
    },

    getState: async (_event, type: WindowType | undefined) => {
      const state = holdStateManager.getSerializableHoldState(type)
      return { state }
    },

    resizeTo: async (_event, type: WindowType, width: number, height: number, animate?: boolean) => {
      const success = logicalWindowManager.resizeTo(type, width, height, animate)
      return { success }
    },

    setBounds: async (_event, type: WindowType, bounds: Partial<WindowBounds>, animate?: boolean) => {
      const success = logicalWindowManager.setBounds(type, bounds, animate)
      return { success }
    },

    getBounds: async (_event, type: WindowType) => {
      const bounds = logicalWindowManager.getBounds(type)
      return { bounds }
    },

    setIgnoreMouseEvents: async (_event, type: WindowType, ignore: boolean, options) => {
      const win = logicalWindowManager.getPhysicalWindow(type)
      if (!win || win.isDestroyed()) {
        return { success: false }
      }

      win.setIgnoreMouseEvents(ignore, options)
      return { success: true }
    },
  },
})

function getLogicalWindowShowOptions(type: WindowType) {
  if (type === WindowType.SHORTCUT_TEST) {
    return {
      bounds: getShortcutTestWindowBounds(),
    }
  }

  return undefined
}

function isAllowedOAuthUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:')
      return false

    const OAUTH_ALLOWED_ENDPOINTS = new Map([
      ['accounts.google.com', '/o/oauth2/v2/auth'],
      ['appleid.apple.com', '/auth/authorize'],
    ])

    return OAUTH_ALLOWED_ENDPOINTS.get(url.hostname) === url.pathname
  }
  catch {
    return false
  }
}

/** 仅允许主窗口触发系统浏览器副作用 */
function assertMainWindowSender(event: unknown): void {
  const senderId = (event as { sender: { id: number } }).sender.id
  const mainWindow = windowManager.get(WindowType.MAIN)

  if (!mainWindow || mainWindow.isDestroyed() || senderId !== mainWindow.webContents.id)
    throw new Error('External OAuth URL must be opened by the main window')
}

/** 合成结束或窗口失焦时，恢复该窗口声明的置顶层级 */
function restoreImeWindowLevel(win: BrowserWindow): void {
  const restore = imeReleasedWindows.get(win)
  if (!restore)
    return
  imeReleasedWindows.delete(win)
  win.off('blur', restore)
  win.off('closed', restore)
  if (win.isDestroyed())
    return
  const type = windowManager.getAllTypes().find(type => windowManager.get(type) === win)
  const config = type
    ? windowManager.getMetadata(type)?.config
    : undefined
  if (!win.isVisible() && config?.setAlwaysOnTopOnShow)
    return
  win.setAlwaysOnTop(true, resolveAlwaysOnTopLevel(config ?? {}))
}

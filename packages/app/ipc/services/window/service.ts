import type { WindowBounds, WindowConfig } from '@shared'
import type { WindowContract } from './contract'
import { createIpcService } from '@ipc/core'
import { holdStateManager } from '@main/shortcuts'
import { getShortcutTestWindowBounds, logicalWindowManager, windowManager } from '@main/window-manager'
import { WindowType } from '@shared'
import { shell } from 'electron'

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

import type { WindowBounds, WindowConfig } from '@shared'
import type { WindowContract } from './contract'
import { createIpcService } from '@ipc/core'
import { holdStateManager } from '@main/keyboard'
import { windowManager } from '@main/window-manager'
import { WindowType } from '@shared'

export const windowService = createIpcService<WindowContract>('window', {
  create: async (_event, type: WindowType, configOverride?: Partial<WindowConfig>) => {
    try {
      if (type === WindowType.OAUTH) {
        return {
          success: false,
          error: 'OAuth windows must be opened through openOAuth',
        }
      }

      const window = windowManager.create(type, configOverride)
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

  show: async (_event, type: WindowType) => {
    const success = windowManager.show(type)
    return { success }
  },

  hide: async (_event, type: WindowType) => {
    const success = windowManager.hide(type)
    return { success }
  },

  toggle: async (_event, type: WindowType) => {
    const visible = windowManager.toggle(type)
    return { success: true, visible }
  },

  destroy: async (_event, type: WindowType) => {
    const success = windowManager.destroy(type)
    return { success }
  },

  isVisible: async (_event, type: WindowType) => {
    const visible = windowManager.isVisible(type)
    return { visible }
  },

  exists: async (_event, type: WindowType) => {
    const exists = windowManager.exists(type)
    return { exists }
  },

  getMetadata: async (_event, type: WindowType) => {
    const metadata = windowManager.getMetadata(type)
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
    const success = windowManager.resizeTo(type, width, height, animate)
    return { success }
  },

  setBounds: async (_event, type: WindowType, bounds: Partial<WindowBounds>, animate?: boolean) => {
    const success = windowManager.setBounds(type, bounds, animate)
    return { success }
  },

  getBounds: async (_event, type: WindowType) => {
    const bounds = windowManager.getBounds(type)
    return { bounds }
  },

  setIgnoreMouseEvents: async (_event, type: WindowType, ignore: boolean, options) => {
    const win = windowManager.get(type)
    if (!win || win.isDestroyed()) {
      return { success: false }
    }

    win.setIgnoreMouseEvents(ignore, options)
    return { success: true }
  },
})

function isAllowedOAuthUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:')
      return false

    return OAUTH_ALLOWED_HOSTS.has(url.hostname)
  }
  catch {
    return false
  }
}

const OAUTH_ALLOWED_HOSTS = new Set([
  'accounts.google.com',
  'appleid.apple.com',
])

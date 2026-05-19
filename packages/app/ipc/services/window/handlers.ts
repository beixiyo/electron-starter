import type { WindowConfig, WindowType } from '@shared'
import { holdStateManager } from '@main/hold-state-manager'
import { windowManager } from '@main/window-manager'

export const windowHandlers = {
  create: async (_event: unknown, type: WindowType, configOverride?: Partial<WindowConfig>) => {
    try {
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

  show: async (_event: unknown, type: WindowType) => {
    const success = windowManager.show(type)
    return { success }
  },

  hide: async (_event: unknown, type: WindowType) => {
    const success = windowManager.hide(type)
    return { success }
  },

  toggle: async (_event: unknown, type: WindowType) => {
    const visible = windowManager.toggle(type)
    return { success: true, visible }
  },

  destroy: async (_event: unknown, type: WindowType) => {
    const success = windowManager.destroy(type)
    return { success }
  },

  isVisible: async (_event: unknown, type: WindowType) => {
    const visible = windowManager.isVisible(type)
    return { visible }
  },

  exists: async (_event: unknown, type: WindowType) => {
    const exists = windowManager.exists(type)
    return { exists }
  },

  getMetadata: async (_event: unknown, type: WindowType) => {
    const metadata = windowManager.getMetadata(type)
    return { metadata }
  },

  getAllTypes: async () => {
    const types = windowManager.getAllTypes()
    return { types }
  },

  release: async (_event: unknown, type: WindowType | undefined, result?: unknown, _options?: { hideWindow?: boolean }) => {
    const holdState = holdStateManager.getHoldState(type)
    if (holdState && holdState.isHolding) {
      holdStateManager.completeHold(type, result)
    }
    return { success: true }
  },

  isHolding: async (_event: unknown, type: WindowType | undefined) => {
    const isHolding = holdStateManager.isHolding(type)
    return { isHolding }
  },

  getState: async (_event: unknown, type: WindowType | undefined) => {
    const state = holdStateManager.getSerializableHoldState(type)
    return { state }
  },

  resizeTo: async (_event: unknown, type: WindowType, width: number, height: number, animate?: boolean) => {
    const success = windowManager.resizeTo(type, width, height, animate)
    return { success }
  },
}

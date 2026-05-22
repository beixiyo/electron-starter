import type { WindowConfig } from '@shared'
import type { WindowContract } from './contract'
import { createIpcService } from '@ipc/core'
import { holdStateManager } from '@main/hold-state-manager'
import { windowManager } from '@main/window-manager'
import { WindowType } from '@shared'

export const windowService = createIpcService<WindowContract>('window', {
  create: async (_event, type: WindowType, configOverride?: Partial<WindowConfig>) => {
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
})

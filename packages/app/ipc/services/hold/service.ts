import type { HoldContract } from './contract'
import { createIpcService } from '@ipc/core'
import { logError } from '@main/utils/logger'
import { windowManager } from '@main/window-manager'
import { WindowType } from '@shared'

export const holdService = createIpcService<HoldContract>('hold', {})

/**
 * 发送长按开始事件到指定窗口
 * @param windowType 窗口类型，可选
 */
export function sendHoldStartEvent(windowType?: WindowType): void {
  try {
    if (windowType) {
      const window = windowManager.get(windowType) || windowManager.create(windowType)
      if (window && !window.isDestroyed()) {
        holdService.emit('start', { windowType }, window)
      }
    }
    else {
      /** 获取主窗口发送 */
      const mainWindow = windowManager.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        holdService.emit('start', { windowType: WindowType.MAIN }, mainWindow)
      }
    }
  }
  catch (error) {
    logError('发送长按开始事件失败', error, {
      module: 'ipc-window',
      operation: 'sendHoldStartEvent',
      context: { windowType },
    })
  }
}

/**
 * 发送长按结束事件到指定窗口
 * @param windowType 窗口类型，可选
 */
export function sendHoldEndEvent(windowType?: WindowType): void {
  try {
    if (windowType) {
      const window = windowManager.get(windowType)
      if (window && !window.isDestroyed()) {
        holdService.emit('end', { windowType }, window)
      }
    }
    else {
      /** 如果没有指定窗口类型，尝试向主窗口发送 */
      const mainWindow = windowManager.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        holdService.emit('end', { windowType: WindowType.MAIN }, mainWindow)
      }
    }
  }
  catch (error) {
    logError('发送长按结束事件失败', error, {
      module: 'ipc-window',
      operation: 'sendHoldEndEvent',
      context: { windowType },
    })
  }
}

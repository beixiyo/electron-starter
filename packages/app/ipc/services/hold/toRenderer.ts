/** 长按状态的 main → renderer 推送面 */

import { createMainToRendererEmitter } from '@ipc/core'
import { createMainDiagnosticLogger } from '@main/logging'
import { windowManager } from '@main/window-manager'
import { WindowType } from '@shared'
import type { HoldContract } from './contract'

const log = createMainDiagnosticLogger('shortcut.runtime')

export const holdToRenderer = createMainToRendererEmitter<HoldContract>('hold')

/**
 * 发送长按开始事件到指定窗口
 * @param windowType 窗口类型，可选
 */
export function sendHoldStartEvent(windowType?: WindowType): void {
  try {
    if (windowType) {
      const window = windowManager.get(windowType) || windowManager.create(windowType)
      if (window && !window.isDestroyed()) {
        holdToRenderer.emit('start', { windowType }, window)
      }
    }
    else {
      /** 获取主窗口发送 */
      const mainWindow = windowManager.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        holdToRenderer.emit('start', { windowType: WindowType.MAIN }, mainWindow)
      }
    }
  }
  catch (error) {
    log.error('hold.start.delivery-failed', 'failed to deliver hold start event', error, { windowType })
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
        holdToRenderer.emit('end', { windowType }, window)
      }
    }
    else {
      /** 如果没有指定窗口类型，尝试向主窗口发送 */
      const mainWindow = windowManager.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        holdToRenderer.emit('end', { windowType: WindowType.MAIN }, mainWindow)
      }
    }
  }
  catch (error) {
    log.error('hold.end.delivery-failed', 'failed to deliver hold end event', error, { windowType })
  }
}

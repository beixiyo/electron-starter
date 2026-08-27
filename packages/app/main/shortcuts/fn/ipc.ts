import { sendFnRawEvent } from '@ipc/services/fn/toRenderer'
import type { BrowserWindow } from 'electron'
import { addFnRawEventListener } from './core'

let removeRawListener: (() => void) | null = null

/** 将 Fn 原始输入转发给当前主窗口，用于设置页录制 */
export function setupFnKeyIpc(mainWindow: BrowserWindow): void {
  removeRawListener?.()
  removeRawListener = addFnRawEventListener((event) => {
    if (!mainWindow.isDestroyed()) sendFnRawEvent(mainWindow, event)
  })
}

export function resetFnKeyIpc(): void {
  removeRawListener?.()
  removeRawListener = null
}

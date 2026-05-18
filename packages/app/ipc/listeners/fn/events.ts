/**
 * fn/Globe 键 IPC 事件发送函数（主进程侧）
 * 通过 webContents.send 向指定窗口推送事件
 */

import type { BrowserWindow } from 'electron'
import { FN_CHANNEL } from '@shared'

/**
 * 向渲染进程发送 fn 键按下事件
 * @param window 目标窗口
 */
export function sendFnDownEvent(window: BrowserWindow): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(FN_CHANNEL.DOWN)
  }
}

/**
 * 向渲染进程发送 fn 键松开事件
 * @param window 目标窗口
 */
export function sendFnUpEvent(window: BrowserWindow): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(FN_CHANNEL.UP)
  }
}

/**
 * 向渲染进程发送 fn 键双击事件
 * @param window 目标窗口
 */
export function sendFnDoublePressEvent(window: BrowserWindow): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(FN_CHANNEL.DOUBLE_PRESS)
  }
}

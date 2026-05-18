/**
 * fn/Globe 键 IPC API（渲染进程侧）
 * 通过 ipcRenderer 订阅主进程推送的 fn 键事件
 */

import { FN_CHANNEL } from '@shared'
import { ipcRenderer } from 'electron'

export const fnApi = {
  /**
   * 监听 fn 键按下事件
   * @param callback 回调函数
   * @returns 取消订阅函数
   */
  onDown(callback: () => void): () => void {
    const handler = () => callback()
    ipcRenderer.on(FN_CHANNEL.DOWN, handler)
    return () => ipcRenderer.off(FN_CHANNEL.DOWN, handler)
  },

  /**
   * 监听 fn 键松开事件
   * @param callback 回调函数
   * @returns 取消订阅函数
   */
  onUp(callback: () => void): () => void {
    const handler = () => callback()
    ipcRenderer.on(FN_CHANNEL.UP, handler)
    return () => ipcRenderer.off(FN_CHANNEL.UP, handler)
  },

  /**
   * 监听 fn 键双击事件
   * @param callback 回调函数
   * @returns 取消订阅函数
   */
  onDoublePress(callback: () => void): () => void {
    const handler = () => callback()
    ipcRenderer.on(FN_CHANNEL.DOUBLE_PRESS, handler)
    return () => ipcRenderer.off(FN_CHANNEL.DOUBLE_PRESS, handler)
  },
}

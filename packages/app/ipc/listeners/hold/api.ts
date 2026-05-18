import type { HoldEndConfig, WindowType } from '@shared'
import { windowApi } from '@ipc/services/window/api'
import { HOLD_CHANNEL } from '@shared'
import { ipcRenderer } from 'electron/renderer'

export const holdApi = {
  /**
   * 通知主进程长按已释放
   * @param config 配置对象
   */
  release(config: HoldEndConfig) {
    const { type, result, hideWindow } = config
    return windowApi.release(type, result, { hideWindow })
  },
  /**
   * 检查是否正在长按
   */
  isHolding(type?: WindowType) {
    return windowApi.isHolding(type)
  },
  /**
   * 获取长按状态
   */
  getState(type?: WindowType) {
    return windowApi.getState(type)
  },
  /**
   * 监听长按开始事件
   * @param callback 回调函数
   */
  onStart(callback: (event: { windowType: WindowType }) => void) {
    ipcRenderer.on(HOLD_CHANNEL.START, (_, data) => callback(data))
    return () => {
      ipcRenderer.removeAllListeners(HOLD_CHANNEL.START)
    }
  },
  /**
   * 监听长按结束事件（快捷键释放）
   * @param callback 回调函数
   */
  onEnd(callback: (event: { windowType: WindowType }) => void) {
    ipcRenderer.on(HOLD_CHANNEL.END, (_, data) => callback(data))
    return () => {
      ipcRenderer.removeAllListeners(HOLD_CHANNEL.END)
    }
  },
}

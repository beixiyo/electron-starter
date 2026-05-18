import type { IpcMainInvokeEvent } from 'electron'
import { windowManager } from '@main/window-manager'
import { SELECTION_RENDERER_CHANNEL, WindowType } from '@shared'

/**
 * Selection 模块的 IPC 处理器实现
 */
export const selectionHandlers = {
  /**
   * 显示选中文本窗口
   */
  async showSelectionWindow(_event: IpcMainInvokeEvent, text: string) {
    try {
      /** 创建或获取窗口 */
      const window = windowManager.create(WindowType.SELECTION)
      if (!window) {
        return {
          success: false,
          error: '无法创建选中文本窗口',
        }
      }

      /** 发送文本数据到渲染进程 */
      window.webContents.send(SELECTION_RENDERER_CHANNEL.DATA, { text })

      /** 显示窗口 */
      windowManager.show(WindowType.SELECTION)
      window.focus()

      return {
        success: true,
      }
    }
    catch (error) {
      console.error('显示选中文本窗口失败:', error)
      return {
        success: false,
        error: error instanceof Error
          ? error.message
          : 'Unknown error',
      }
    }
  },

  /**
   * 关闭选中文本窗口
   */
  async closeSelectionWindow() {
    try {
      const success = windowManager.hide(WindowType.SELECTION)
      return { success }
    }
    catch (error) {
      console.error('关闭选中文本窗口失败:', error)
      return {
        success: false,
        error: error instanceof Error
          ? error.message
          : 'Unknown error',
      }
    }
  },
}

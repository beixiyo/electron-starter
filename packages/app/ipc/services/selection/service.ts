import type { SelectionContract } from './contract'
import { createIpcService } from '@ipc/core'
import { logicalWindowManager } from '@main/window-manager'
import { WindowType } from '@shared'

export const selectionService = createIpcService<SelectionContract>('selection', {
  mainHandle: {
  /**
   * 显示选中文本窗口
   */
    async showSelectionWindow(_event, text: string) {
      try {
        const window = logicalWindowManager.show(WindowType.SELECTION, {
          payload: { text },
        })
        if (!window) {
          return {
            success: false,
            error: '无法创建选中文本窗口',
          }
        }
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
        const success = logicalWindowManager.hide(WindowType.SELECTION)
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
  },
})

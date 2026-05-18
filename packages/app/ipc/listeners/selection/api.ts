import type { SelectionData } from '@shared'
import { windowApi } from '@ipc/services/window/api'
import { SELECTION_RENDERER_CHANNEL, WindowType } from '@shared'
import { ipcRenderer } from 'electron'

/**
 * Selection 窗口 API
 */
export const selectionApi = {
  /**
   * 显示 Selection 窗口
   */
  showSelection() {
    return windowApi.show(WindowType.SELECTION)
  },
  /**
   * 隐藏 Selection 窗口
   */
  hideSelection() {
    return windowApi.hide(WindowType.SELECTION)
  },
  /**
   * 切换 Selection 窗口显示状态
   */
  toggleSelection() {
    return windowApi.toggle(WindowType.SELECTION)
  },
  /**
   * 检查 Selection 窗口是否可见
   */
  isSelectionVisible() {
    return windowApi.isVisible(WindowType.SELECTION)
  },
  /**
   * 监听 Selection 数据变更
   */
  onDataChange(callback: (data: SelectionData) => void) {
    const handler = (_: unknown, data: SelectionData) => {
      callback(data)
    }
    ipcRenderer.on(SELECTION_RENDERER_CHANNEL.DATA, handler)
    return () => {
      ipcRenderer.removeListener(SELECTION_RENDERER_CHANNEL.DATA, handler)
    }
  },
}

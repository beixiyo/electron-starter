import { app } from 'electron'
import { resetFnKeyIpc, stopFnKeyListener } from './fn'
import { resetKeyboardGestureShortcutStates } from './global'
import { holdStateManager } from './hold'

/**
 * 应用退出前取消注册所有快捷键
 */
app.on('will-quit', () => {
  if (!app.isReady()) {
    return
  }

  /** 清理所有长按状态 */
  holdStateManager.clearAll()

  /** 清理用户自定义键盘手势快捷键状态 */
  resetKeyboardGestureShortcutStates()

  if (process.platform === 'darwin') {
    /** 清理 fn 键快捷键状态 */
    resetFnKeyIpc()

    /** 停止 fn-listener Swift 子进程 */
    stopFnKeyListener()
  }
})

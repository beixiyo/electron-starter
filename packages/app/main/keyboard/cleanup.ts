import { app } from 'electron'
import { resetFnShortcutStates, stopFnKeyListener } from './fn'
import { resetKeyboardGestureShortcutStates, unregisterAllGlobalShortcuts } from './global'
import { getHoldShortcutsMap, resetHoldShortcutStates } from './hold'

/**
 * 应用退出前取消注册所有快捷键
 */
app.on('will-quit', () => {
  if (!app.isReady()) {
    return
  }

  /** 清理所有长按状态与监听器 */
  resetHoldShortcutStates()

  /** 清理长按快捷键配置 */
  getHoldShortcutsMap().clear()

  /** 清理用户自定义键盘手势快捷键状态 */
  resetKeyboardGestureShortcutStates()

  if (process.platform === 'darwin') {
    /** 清理 fn 键快捷键状态 */
    resetFnShortcutStates()

    /** 停止 fn-listener Swift 子进程 */
    stopFnKeyListener()
  }

  /** 取消注册所有全局快捷键 */
  unregisterAllGlobalShortcuts()
})

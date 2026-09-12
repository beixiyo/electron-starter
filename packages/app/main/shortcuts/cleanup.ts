import { app } from 'electron'
import { keyboardInputBackend } from './input'
import { systemInputShortcutRuntimeBackend } from './input-runtime-backend'

/**
 * 应用退出前取消注册所有快捷键并释放捕获后端
 */
app.on('will-quit', () => {
  if (!app.isReady()) {
    return
  }

  /** 释放已触发的 hold 并摘掉输入订阅 */
  systemInputShortcutRuntimeBackend.reset()

  /** macOS 停掉 keyboard-listener 子进程；uIOhook Worker 随进程退出 */
  keyboardInputBackend.shutdown()
})

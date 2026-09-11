/** 按平台选定唯一的系统级键盘捕获后端 */

import type { KeyboardInputBackend } from './backend'
import { nativeMacKeyboardInputBackend } from './native-mac/backend'
import { uiohookKeyboardInputBackend } from './uiohook/backend'

/**
 * 当前平台的键盘捕获后端
 *
 * macOS 用 keyboard-listener helper：它能看到 Fn/Globe，跑在独立进程里，崩溃可恢复；
 * 其余平台用 uIOhook。所有消费者只依赖这一个入口，不感知底层实现
 */
export const keyboardInputBackend: KeyboardInputBackend = process.platform === 'darwin'
  ? nativeMacKeyboardInputBackend
  : uiohookKeyboardInputBackend

export type { KeyboardInputBackend, KeyboardInputBackendId, KeyboardInputListener } from './backend'

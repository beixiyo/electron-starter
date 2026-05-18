/**
 * fn/Globe 键相关 IPC 事件
 *
 * 交互流程：
 * - Swift 子进程通过 IOHIDManager 监听 fn/Globe 键
 * - 主进程解析 stdout 输出（FN_DOWN / FN_UP），转发给渲染进程
 * - 渲染进程通过 window.$ipc.fn 监听对应事件
 */
export const FN_CHANNEL = {
  /**
   * fn 键按下事件（单向事件）
   * 方向：主进程 → 渲染进程
   */
  DOWN: 'fn:down',
  /**
   * fn 键松开事件（单向事件）
   * 方向：主进程 → 渲染进程
   */
  UP: 'fn:up',
  /**
   * fn 键双击事件（单向事件）
   * 方向：主进程 → 渲染进程
   * 触发时机：两次按下间隔 ≤ FN_DOUBLE_PRESS_INTERVAL_MS
   */
  DOUBLE_PRESS: 'fn:doublePress',
} as const

/**
 * fn/Globe 键 IPC 事件的字符串字面量联合类型
 */
export type FnChannel = typeof FN_CHANNEL[keyof typeof FN_CHANNEL]

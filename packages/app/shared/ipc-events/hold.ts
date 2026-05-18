/**
 * 长按交互相关 IPC 事件
 *
 * 交互流程：
 * 1. 用户按下快捷键 → 主进程发送 `hold:start` → 渲染进程收到，开始计时
 * 2. 用户松开快捷键 → 主进程检测到释放 → 主进程发送 `hold:end` → 渲染进程收到
 * 3. 渲染进程收到 `hold:end` → 计算结果（transcript、duration 等）→ 调用 `hold:release` → 主进程收到，调用 onRelease 回调
 *
 * 关系说明：
 * - `hold:start` 和 `hold:end` 是主进程 → 渲染进程的单向事件（使用 webContents.send）
 * - `hold:release` 是渲染进程 → 主进程的双向调用（使用 ipcRenderer.invoke / ipcMain.handle）
 * - `hold:end` 和 `hold:release` 有明确的交互关系：与 `hold:end` 配合使用，渲染进程收到 `hold:end` 后调用此事件
 * 使用位置：
 *   - 发送：packages/electron/main/shortcuts/hold-shortcut.ts
 *   - 接收：packages/electron/ipc/window/handlers.ts
 */
export const HOLD_CHANNEL = {
  /**
   * 长按释放事件（双向调用）
   * 方向：渲染进程 → 主进程
   * 触发时机：渲染进程收到 `hold:end` 事件后，计算完结果数据后调用
   * 作用：通知主进程长按已释放，并传递结果数据（如 transcript、duration 等）
   * 关联事件：与 `hold:end` 配合使用，渲染进程收到 `hold:end` 后调用此事件
   * 使用位置：
   *   - 发送：packages/app/renderer/VoiceImeApp.tsx
   *   - 接收：packages/electron/ipc/window/handlers.ts
   */
  RELEASE: 'hold:release',
  /**
   * 检查是否正在长按（双向调用）
   * 方向：渲染进程 → 主进程
   * 作用：查询指定窗口类型是否正在长按状态
   */
  IS_HOLDING: 'hold:isHolding',
  /**
   * 获取长按状态（双向调用）
   * 方向：渲染进程 → 主进程
   * 作用：获取指定窗口类型的完整长按状态信息
   */
  GET_STATE: 'hold:getState',
  /**
   * 长按开始事件（单向事件）
   * 方向：主进程 → 渲染进程
   * 触发时机：用户按下长按快捷键时
   * 作用：通知渲染进程长按已开始，渲染进程可以开始计时或初始化状态
   * 关联事件：与 `hold:end` 和 `hold:release` 形成完整的长按交互流程
   * 使用位置：
   *   - 发送：packages/electron/src/main/shortcuts/hold-shortcut.ts
   *   - 接收：packages/electron/src/preload/hold.ts (通过 window.api.hold.onStart 监听)
   */
  START: 'hold:start',
  /**
   * 长按结束事件（单向事件）
   * 方向：主进程 → 渲染进程
   * 触发时机：主进程通过轮询检测到用户松开快捷键时
   * 作用：通知渲染进程快捷键已释放，渲染进程应计算最终结果并调用 `hold:release`
   * 关联事件：
   *   - 由 `hold:start` 开始的长按流程的结束信号
   *   - 触发后，渲染进程应调用 `hold:release` 传递结果数据
   * 使用位置：
   *   - 发送：packages/electron/main/shortcuts/hold-shortcut.ts (handleHoldRelease 函数)
   *   - 接收：packages/electron/preload/ipc/hold.ts (通过 window.api.hold.onEnd 监听)
   */
  END: 'hold:end',
} as const

/**
 * 长按相关事件的字符串字面量联合类型
 */
export type HoldChannel = typeof HOLD_CHANNEL[keyof typeof HOLD_CHANNEL]

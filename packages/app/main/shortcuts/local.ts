import type { BrowserWindow } from 'electron'

/**
 * 应用内快捷键管理器
 * 用于管理应用窗口内的快捷键（仅在应用获得焦点时生效）
 *
 * @deprecated 此模块中的函数目前为占位符实现，尚未实际使用。
 * 如需实现应用内快捷键功能，请参考以下实现方案：
 *
 * ## 实现方案
 *
 * ### 方案 1: 使用 before-input-event 事件（推荐）
 * ```typescript
 * window.webContents.on('before-input-event', (event, input) => {
 *   if (input.control && input.shift && input.key.toLowerCase() === 'k') {
 *     event.preventDefault()
 *     callback()
 *   }
 * })
 * ```
 *
 * ### 方案 2: 使用 Menu 菜单项
 * 通过 Electron 的 Menu API 定义快捷键，快捷键会自动绑定到菜单项。
 *
 * ### 方案 3: 通过 IPC 通信
 * 在渲染进程中监听键盘事件，通过 IPC 发送到主进程处理。
 *
 * ## 注意事项
 * - 应用内快捷键仅在窗口获得焦点时生效
 * - 需要处理快捷键冲突检测
 * - 需要管理每个窗口的快捷键映射表
 * - 窗口销毁时需要清理相关事件监听器
 */

/**
 * 注册应用内快捷键
 * @deprecated 此函数为占位符实现，目前未被使用。如需使用，请先实现具体逻辑。
 * @param window 目标窗口
 * @param accelerator 快捷键组合，例如 'CommandOrControl+K'
 * @param callback 快捷键触发时的回调函数
 * @returns 是否注册成功
 */
export function registerLocalShortcut(
  window: BrowserWindow,
  accelerator: string,
  callback: () => void,
): boolean {
  /**
   * TODO: 实现应用内快捷键注册逻辑
   * 建议使用 window.webContents.on('before-input-event') 监听键盘事件
   * 需要：
   * 1. 解析 accelerator 字符串（如 'CommandOrControl+K'）
   * 2. 在 before-input-event 中匹配按键组合
   * 3. 调用 callback
   * 4. 管理每个窗口的快捷键映射表
   * 5. 处理快捷键冲突
   */
  console.warn(
    `[DEPRECATED] registerLocalShortcut 为占位符实现，快捷键 ${accelerator} 未实际注册 (window ${window.id})`,
  )
  return false
}

/**
 * 取消注册应用内快捷键
 * @deprecated 此函数为占位符实现，目前未被使用。如需使用，请先实现具体逻辑。
 * @param window 目标窗口
 * @param accelerator 快捷键组合
 */
export function unregisterLocalShortcut(
  window: BrowserWindow,
  accelerator: string,
): void {
  /**
   * TODO: 实现应用内快捷键取消注册逻辑
   * 需要：
   * 1. 从快捷键映射表中移除对应条目
   * 2. 移除 before-input-event 事件监听器（如果使用该方案）
   */
  console.warn(
    `[DEPRECATED] unregisterLocalShortcut 为占位符实现，快捷键 ${accelerator} 未实际取消注册 (window ${window.id})`,
  )
}

/**
 * 环境检测工具函数
 * 用于判断当前运行环境是 Electron 还是 Web
 */

export function isElectron(): boolean {
  /**
   * 在 web 环境下，window.$electron 和 window.$ipc 不存在
   * 使用 typeof 检查可以避免在 web 环境下报错
   */
  return typeof window !== 'undefined'
    && typeof (window as any).$electron !== 'undefined'
    && typeof (window as any).$ipc !== 'undefined'
}

/**
 * 判断当前是否运行在 Web 环境中
 *
 * @returns 如果是 Web 环境返回 true，否则返回 false
 *
 * @example
 * ```ts
 * if (isWeb()) {
 *   // Web 特定逻辑
 *   console.log('Running in browser')
 * }
 * ```
 */
export function isWeb(): boolean {
  return !isElectron()
}

/**
 * 类型守卫：确保当前环境是 Electron
 * 用于 TypeScript 类型收窄
 *
 * @param _window - window 对象（用于类型推断）
 * @returns 类型谓词，如果是 Electron 环境返回 true
 */
export function isElectronEnv(_window: Window): _window is Window & {
  $electron: any
  $ipc: any
} {
  return isElectron()
}

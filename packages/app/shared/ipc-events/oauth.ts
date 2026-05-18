/**
 * OAuth 相关 IPC 事件
 */
export const OAUTH_CHANNEL = {
  /**
   * OAuth 回调事件（单向事件）
   * 方向：主进程 → 渲染进程
   * 触发时机：主进程拦截到 OAuth 回调 URL 时
   * 作用：通知渲染进程 OAuth 授权码已获取
   */
  CALLBACK: 'oauth:callback',
} as const

/**
 * OAuth 相关事件的字符串字面量联合类型
 */
export type OAuthChannel = typeof OAUTH_CHANNEL[keyof typeof OAUTH_CHANNEL]

/**
 * OAuth 回调参数类型
 * 用于主进程和渲染进程之间的 IPC 通信
 */
export type OAuthProvider = 'apple' | 'google'

export interface OAuthCallbackParams {
  code?: string
  state?: string
  /** Apple 首次授权时由受控 callback 中心提取的显示名称 */
  username?: string
  error?: string
  error_description?: string
  id_token?: string
  provider?: OAuthProvider
}

/** 主进程投递给登录页的 OAuth 回调，只有收到显式确认后才会从 pending 中移除 */
export interface OAuthCallbackDelivery {
  id: string
  params: OAuthCallbackParams
}

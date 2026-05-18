/**
 * OAuth 回调参数类型
 * 用于主进程和渲染进程之间的 IPC 通信
 */
export type OAuthProvider = 'apple' | 'google'

export interface OAuthCallbackParams {
  code?: string
  state?: string
  error?: string
  error_description?: string
  id_token?: string
  provider?: OAuthProvider
}

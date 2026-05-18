import { oauthEventListeners } from './client-events'

/**
 * OAuth 相关 API
 */
export const oauthApi = {
  /**
   * 监听 OAuth 回调
   * 当主进程拦截到 OAuth 回调 URL 时触发
   */
  onCallback(callback: (params: any) => void) {
    return oauthEventListeners.onCallback(callback)
  },
}

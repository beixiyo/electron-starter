import type { OAuthCallbackParams } from '@shared'
import { OAUTH_CHANNEL } from '@shared'
import { ipcRenderer } from 'electron'

/**
 * OAuth 模块客户端事件监听器
 */
export const oauthEventListeners = {
  /**
   * 监听 OAuth 回调事件
   */
  onCallback: (callback: (params: OAuthCallbackParams) => void) => {
    const handler = (_: unknown, params: OAuthCallbackParams) => {
      callback(params)
    }
    ipcRenderer.on(OAUTH_CHANNEL.CALLBACK, handler)
    return () => {
      ipcRenderer.removeListener(OAUTH_CHANNEL.CALLBACK, handler)
    }
  },
}

import type { OAuthCallbackParams } from '@shared'
import type { BrowserWindow } from 'electron'
import { OAUTH_CHANNEL } from '@shared'

/**
 * 发送 OAuth 回调事件到渲染进程
 * @param window 目标窗口
 * @param params OAuth 回调参数
 */
export function sendOAuthCallback(window: BrowserWindow, params: OAuthCallbackParams): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(OAUTH_CHANNEL.CALLBACK, params)
  }
}

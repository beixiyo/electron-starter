import type { OAuthCallbackParams } from '@shared'
import type { BrowserWindow } from 'electron'
import type { OAuthContract } from './contract'
import { createIpcService } from '@ipc/core'

export const oauthService = createIpcService<OAuthContract>('oauth', {})

export function sendOAuthCallback(window: BrowserWindow, params: OAuthCallbackParams): void {
  if (window && !window.isDestroyed())
    oauthService.emit('callback', params, window)
}

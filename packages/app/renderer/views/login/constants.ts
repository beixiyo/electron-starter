import { APPLE_OAUTH_URL, buildOAuthUrl, GOOGLE_OAUTH_URL } from '@jl-org/auth'
import { isElectron } from '@/utils/env'

export const GOOGLE_CLIENT_ID = isElectron()
  ? import.meta.env.VITE_ELECTRON_GOOGLE_CLIENT_ID
  : import.meta.env.VITE_WEB_GOOGLE_CLIENT_ID
export const GOOGLE_REDIRECT_URI = isElectron()
  ? import.meta.env.VITE_ELECTRON_GOOGLE_REDIRECT_URI
  : import.meta.env.VITE_WEB_GOOGLE_REDIRECT_URI

export const APPLE_CLIENT_ID = isElectron()
  ? import.meta.env.VITE_ELECTRON_APPLE_CLIENT_ID
  : import.meta.env.VITE_WEB_APPLE_CLIENT_ID
export const APPLE_REDIRECT_URI = isElectron()
  ? import.meta.env.VITE_ELECTRON_APPLE_REDIRECT_URI
  : import.meta.env.VITE_WEB_APPLE_REDIRECT_URI

export const APPLE_SCOPE = isElectron()
  ? import.meta.env.VITE_ELECTRON_APPLE_SCOPE
  : import.meta.env.VITE_WEB_APPLE_SCOPE
export const APPLE_STATE = isElectron()
  ? import.meta.env.VITE_ELECTRON_APPLE_STATE
  : import.meta.env.VITE_WEB_APPLE_STATE
export const GOOGLE_SCOPE = 'openid email profile'

export function buildClientContext() {
  const clientName = isElectron()
    ? 'desktop'
    : 'web'
  const osVersion = isElectron()
    ? typeof navigator !== 'undefined'
      ? navigator.userAgent.slice(0, 45)
      : 'electron'
    : 'web'
  const modelName = isElectron()
    ? 'electron'
    : 'web'

  return {
    client_name: clientName,
    os_version: osVersion,
    client_model_name: modelName,
  }
}

export function buildAppleAuthorizeUrl() {
  if (!APPLE_CLIENT_ID || !APPLE_REDIRECT_URI) {
    throw new Error('Apple OAuth 配置缺失')
  }

  return buildOAuthUrl(APPLE_OAUTH_URL, {
    client_id: APPLE_CLIENT_ID,
    redirect_uri: APPLE_REDIRECT_URI,
    scope: APPLE_SCOPE,
    response_mode: 'form_post',
  })
}

export function buildGoogleAuthorizeUrl() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
    throw new Error('Google OAuth 配置缺失')
  }

  return buildOAuthUrl(GOOGLE_OAUTH_URL, {
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    scope: GOOGLE_SCOPE,
  })
}

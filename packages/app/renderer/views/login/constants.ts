/**
 * 集中读取登录配置，并为 Web 弹窗和 Electron 系统浏览器构造 OAuth 参数
 */
import { APPLE_OAUTH_URL, GOOGLE_OAUTH_URL } from '@jl-org/auth'
import { isElectron } from '@/utils/env'
import { getRuntimeEnv } from '@/config/runtimeEnv'

/** 在授权发起时读取配置，让环境切换影响下一次登录。 */
export function getOAuthConfig() {
  const electron = isElectron()
  const endpoints = getRuntimeEnv()
  return {
    googleClientId: electron
      ? import.meta.env.VITE_ELECTRON_GOOGLE_CLIENT_ID
      : import.meta.env.VITE_WEB_GOOGLE_CLIENT_ID,
    googleRedirectUri: endpoints.googleRedirectUri,
    appleClientId: electron
      ? import.meta.env.VITE_ELECTRON_APPLE_CLIENT_ID
      : import.meta.env.VITE_WEB_APPLE_CLIENT_ID,
    appleRedirectUri: endpoints.appleRedirectUri,
    appleScope: electron
      ? import.meta.env.VITE_ELECTRON_APPLE_SCOPE
      : import.meta.env.VITE_WEB_APPLE_SCOPE,
    appleState: electron
      ? import.meta.env.VITE_ELECTRON_APPLE_STATE
      : import.meta.env.VITE_WEB_APPLE_STATE,
  }
}

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

export function buildAppleAuthorizeUrl(state?: string) {
  const { appleClientId, appleRedirectUri, appleScope } = getOAuthConfig()
  if (!appleClientId || !appleRedirectUri) {
    throw new Error('Apple OAuth 配置缺失')
  }

  return buildAuthorizeUrl(APPLE_OAUTH_URL, {
    client_id: appleClientId,
    redirect_uri: appleRedirectUri,
    scope: appleScope,
    response_mode: 'form_post',
    ...(state
      ? { state }
      : {}),
  })
}

export function buildGoogleAuthorizeUrl(state?: string) {
  const { googleClientId, googleRedirectUri } = getOAuthConfig()
  if (!googleClientId || !googleRedirectUri) {
    throw new Error('Google OAuth 配置缺失')
  }

  return buildAuthorizeUrl(GOOGLE_OAUTH_URL, {
    client_id: googleClientId,
    redirect_uri: googleRedirectUri,
    scope: GOOGLE_SCOPE,
    ...(state
      ? { state }
      : {}),
  })
}

/**
 * 使用 URLSearchParams 编码 OAuth 参数，确保 redirect_uri 内部的 query 不会泄漏到授权端点
 */
function buildAuthorizeUrl(baseUrl: string, params: Record<string, string>) {
  const url = new URL(baseUrl)

  for (const [name, value] of Object.entries({
    ...params,
    response_type: 'code',
  })) {
    url.searchParams.set(name, value)
  }

  return url.toString()
}

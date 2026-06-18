import type { OAuthCallbackParams } from '@shared'
import type { BrowserWindow } from 'electron'
import { sendOAuthCallback } from '@ipc/services/oauth/service'
import { dataToStr, getHostname, getProtocol, getUrlQuery } from '@jl-org/tool'
import { WindowType } from '@shared'
import { session } from 'electron'
import { windowManager } from './window-manager'

export function getUrl(url: string) {
  return `${getProtocol(url)}://${getHostname(url)}`
}

/**
 * 设置 OAuth 拦截器
 * 拦截 OAuth 回调请求（localhost 或 127.0.0.1），提取授权码并通过 IPC 发送给渲染进程
 */
export function setupOAuthInterceptor(mainWindow: BrowserWindow): void {
  const rawApple = import.meta.env.VITE_ELECTRON_APPLE_REDIRECT_URI
  const rawGoogle = import.meta.env.VITE_ELECTRON_GOOGLE_REDIRECT_URI

  const appleRedirectOrigin = rawApple ? getUrl(rawApple) : null
  const googleRedirectOrigin = rawGoogle ? getUrl(rawGoogle) : null

  const filterUrls: string[] = []
  appleRedirectOrigin && filterUrls.push(`${appleRedirectOrigin}/*`)
  googleRedirectOrigin && filterUrls.push(`${googleRedirectOrigin}/*`)

  console.log('[oauth-interceptor] 拦截器配置:', filterUrls)

  if (!filterUrls.length) {
    console.log('[oauth-interceptor] 未配置 redirect URI，跳过拦截器注册')
    return
  }

  session.defaultSession.webRequest.onBeforeRequest(
    { urls: filterUrls },
    (details, respond) => {
      try {
        const url = new URL(details.url)
        console.log('[oauth-interceptor] 拦截到请求:', details.url)
        const payloadBytes = details.uploadData?.[0]?.bytes
        const str = payloadBytes
          ? dataToStr(payloadBytes)
          : ''
        const data = getUrlQuery(`${url.href}?${str}`, url.href)
        console.log(data)

        const provider = detectProvider(details.url, rawApple, rawGoogle)

        sendOAuthCallback(mainWindow, {
          ...data,
          provider,
        })
        closeOAuthWindowIfNeeded(provider)
        respond({ cancel: true })
      }
      catch (error) {
        console.error('[oauth-interceptor] ❌ 处理回调时出错:', error)
        respond({})
      }
    },
  )

  console.log('[oauth-interceptor] ✅ OAuth 拦截器已设置，等待 OAuth 回调...')
}

function detectProvider(
  url: string,
  appleRedirectUri: string | null,
  googleRedirectUri: string | null,
): OAuthCallbackParams['provider'] {
  if (appleRedirectUri && isCallbackUrl(url, appleRedirectUri)) {
    return 'apple'
  }
  if (googleRedirectUri && isCallbackUrl(url, googleRedirectUri)) {
    return 'google'
  }
  return undefined
}

function isCallbackUrl(url: string, redirectUri: string) {
  const callbackUrl = new URL(url)
  const targetUrl = new URL(redirectUri)

  return callbackUrl.origin === targetUrl.origin
    && callbackUrl.pathname === targetUrl.pathname
}

function closeOAuthWindowIfNeeded(provider: OAuthCallbackParams['provider']) {
  if (!provider) {
    return
  }
  const oauthWindow = windowManager.get(WindowType.OAUTH)
  if (oauthWindow && !oauthWindow.isDestroyed()) {
    oauthWindow.close()
  }
  const mainWindow = windowManager.get(WindowType.MAIN)
  mainWindow?.show()
  mainWindow?.focus()
}

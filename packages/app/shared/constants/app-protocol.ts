import type { Privileges } from 'electron'

export const APP_PROTOCOL = 'xxx'

/** macOS Bundle ID，与 electron-builder.yml 的 appId 及 setAppUserModelId 保持一致 */
export const APP_BUNDLE_ID = 'com.xxx'

export const APP_PROTOCOL_PRIVILEGES: Privileges = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  corsEnabled: true,
  stream: true,
}

export const APP_PROTOCOL_HOST = 'app'

export function buildAppProtocolUrl(pathname = 'index.html'): string {
  const normalizedPath = pathname.startsWith('/')
    ? pathname.slice(1)
    : pathname
  return `${APP_PROTOCOL}://${APP_PROTOCOL_HOST}/${encodeURI(normalizedPath)}`
}

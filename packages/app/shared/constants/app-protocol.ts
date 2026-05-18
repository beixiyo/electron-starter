import type { Privileges } from 'electron'

export const APP_PROTOCOL = 'xxx'

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

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_PROTOCOL, APP_PROTOCOL_PRIVILEGES } from '@shared'
import { app, net, protocol } from 'electron'

export function initProtocol() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_PROTOCOL,
      privileges: APP_PROTOCOL_PRIVILEGES,
    },
  ])
}

/**
 * 为静态资源注册自定义协议
 */
export function setupAppProtocol(): void {
  const rendererDistDir = join(app.getAppPath(), 'out', 'renderer')

  protocol.handle(APP_PROTOCOL, async (request) => {
    try {
      const requestUrl = new URL(request.url)
      const pathname = decodeURIComponent(requestUrl.pathname)
      const relativePath = pathname && pathname !== '/'
        ? pathname.replace(/^\/+/, '')
        : 'index.html'
      const fileUrl = pathToFileURL(join(rendererDistDir, relativePath)).toString()
      return await net.fetch(fileUrl)
    }
    catch (error) {
      console.error('[protocol] failed to resolve renderer asset', error)
      return new Response(null, { status: 404 })
    }
  })
}

import type { Resp } from '@jl-org/http'
import type { Resp as MyResp } from 'http-api'
import { createApiInstances, createHttpInstance } from 'http-api'
import { getRuntimeEnv } from '@/config/runtimeEnv'
import { createRendererFeatureLogger } from '@/logging'
import { runUnauthorizedHandler } from './unauthorizedGate'

const log = createRendererFeatureLogger('http.client')

const http = createHttpInstance({
  getAppHeaders: () => ({ 'x-app-version': __APP_VERSION__ }),
  onDiagnosticEvent: (event, meta) => log.info(event, 'HTTP authentication lifecycle', meta),
  authMode: 'session',
  baseUrl: () => getRuntimeEnv().apiBaseUrl,
  respInterceptor: (response: Resp<MyResp>) => {
    return response.data.data
  },
  onUnauthorized: () => {
    /** 闸门已经记录失败；HTTP 的同步通知槽不能留下未处理的 Promise。 */
    void runUnauthorizedHandler().catch(() => {})
  },
})

export const api = createApiInstances(http)
export { http }

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as any).api = api
}

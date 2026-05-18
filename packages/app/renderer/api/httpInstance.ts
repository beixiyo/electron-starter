import type { Resp } from '@jl-org/http'
import type { Resp as MyResp } from 'http-api'
import { Message } from 'comps'
import { createApiInstances, createHttpInstance } from 'http-api'
import { router } from '@/router'
import { isElectron } from '@/utils/env'

const http = createHttpInstance({
  baseUrl: isElectron()
    ? import.meta.env.VITE_ELECTRON_API_BASE_URL
    : import.meta.env.VITE_WEB_API_BASE_URL,
  respInterceptor: (response: Resp<MyResp>) => {
    return response.data.data
  },
  onUnauthorized: () => {
    Message.danger('Login expired, please login again')
    /** 延迟导入 UserActions 避免循环依赖 */
    import('@/store/user').then(({ UserActions }) => {
      UserActions.logout()
    })
    router.replace('/login')
  },
})

export const api = createApiInstances(http)
export { http }

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as any).api = api
}

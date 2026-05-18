/**
 * 路由配置
 * 使用文件路由自动生成
 */
import { createHashRouter } from '@jl-org/react-router'
import { Loading } from 'comps'
import { fileRoutes } from './file-routes'

export const router = createHashRouter({
  routes: fileRoutes,
  options: {
    loadingComponent: <Loading loading />,
    /** 页面缓存配置 */
    cache: {
      limit: 10,
      exclude: ['/login', '/', /^\/cards\/[^/]+$/],
    },
    /** 全局前置守卫 */
    beforeEach: async (ctx, _from, next) => {
      const pathname = ctx.to.pathname

      /** 访问首页时重定向到录屏器 */
      if (pathname === '/') {
        next('/recorder')
        return
      }

      /** 登录页直接放行 */
      if (pathname === '/login') {
        await next()
        return
      }

      // /** 其他路由统一校验登录态 */
      // const canAccess = await checkLogin()
      // if (!canAccess) {
      //   next('/login')
      //   return
      // }

      await next()
    },
  },
})

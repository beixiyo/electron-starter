import type { RouteObject } from '@jl-org/react-router'
import { genRoutes } from '@jl-org/vite-auto-route'
import { lazy } from 'react'
import Index from '../views'

export const fileRoutes: RouteObject[] = [
  {
    path: '/',
    component: Index,
    children: [
      ...genRoutes({
        globComponentsImport: () => import.meta.glob('/views/**/page.tsx'),
        indexFileName: '/page.tsx',
        routerPathFolder: 'views',
        pathPrefix: /^\/views/,
        /** 使用 customizeRoute 自定义路由项，例如启用懒加载 */
        customizeRoute: (_context) => {
          return (route) => {
            const customizedRoute: RouteObject = {
              ...route,
              component: lazy(route.component),
            }

            return customizedRoute
          }
        },
        transformRoute: (route) => {
          return ['/', '/login', '/speak'].includes(route.path)
            ? null
            : route
        },
      }) as RouteObject[],
    ],
  },
  {
    path: '/login',
    component: lazy(() => import('../views/login/page')),
  },
]

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

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { AppErrorBoundary } from '@/components/AppErrorBoundary'
import { initRendererDiagnostics } from '@/logging'
import { Message } from 'comps'
import { ENABLE_REQUEST_MOCKS } from '@/featureFlags'
import { registerUnauthorizedHandler } from '@/http/unauthorizedGate'
import { router } from '@/router'
import { UserActions } from '@/store/user'
import { installWebIpcShim } from '@/utils/ipcWebShim'

import App from './App'
import { initMainNavigation } from './main-navigation'
import '@/tailwind.css'
import '@/locales'

/** 必须在任何业务模块访问 $ipc 之前执行：web 下给 window.$ipc 挂 no-op 代理，避免裸 $ipc 抛 ReferenceError */
installWebIpcShim()
initRendererDiagnostics()
initMainNavigation()

const unregisterUnauthorized = registerUnauthorizedHandler(async () => {
  Message.danger('Login expired, please login again')
  await UserActions.logout()
  router.replace('/login')
})
import.meta.hot?.dispose(unregisterUnauthorized)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

/** 开发期先同步模拟请求，再挂载消费方；启动失败仍允许页面进入真实请求模式。 */
async function mountApp(): Promise<void> {
  if (import.meta.env.DEV && ENABLE_REQUEST_MOCKS) {
    try {
      const { initMock } = await import('@/mocks')
      await initMock()
    }
    catch (error) {
      console.warn('Mock runtime initialization failed', error)
    }
  }

  createRoot(document.getElementById('root')!).render(
    <AppErrorBoundary scope="main-window-root">
      <QueryClientProvider client={ queryClient }>
        <App />
      </QueryClientProvider>
    </AppErrorBoundary>,
  )
}

void mountApp()

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { installWebIpcShim } from '@/utils/ipcWebShim'

import App from './App'
import '@/tailwind.css'
import '@/locales'

/** 必须在任何业务模块访问 $ipc 之前执行：web 下给 window.$ipc 挂 no-op 代理，避免裸 $ipc 抛 ReferenceError */
installWebIpcShim()

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

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={ queryClient }>
    <App />
  </QueryClientProvider>,
)

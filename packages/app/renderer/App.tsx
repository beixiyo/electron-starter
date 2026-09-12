import { EnvSwitchHotspot } from '@/components/EnvSwitcher'
import { ENABLE_REQUEST_MOCKS, ENABLE_RUNTIME_TOOLS } from '@/featureFlags'
import { UpdaterModal } from '@/components/updater'
import { router } from '@/router'
import { useShortcutRuntime } from '@/shortcuts'
import { initUpdaterStore } from '@/store/updaterStore'
import { Outlet, RouterProvider } from '@jl-org/react-router'
import { useTheme } from 'hooks'
import { AnimatePresence } from 'motion/react'
import { lazy, Suspense } from 'react'

const MockDebugPanel = import.meta.env.DEV && ENABLE_REQUEST_MOCKS
  ? lazy(() => import('@/mocks/MockDebugPanel').then(module => ({ default: module.MockDebugPanel })))
  : null

function App() {
  useTheme()
  useShortcutRuntime()

  /** 订阅主进程更新事件（一次）：后台轮询发现新版本时驱动全局更新弹窗 */
  useEffect(() => {
    initUpdaterStore()
  }, [])

  return (
    <AnimatePresence>
      <div className="min-h-full bg-background3 text-text">
        <RouterProvider router={ router }>
          <GlobalDebugRouter />
          <Outlet />

          <UpdaterModal />
          { ENABLE_RUNTIME_TOOLS && <EnvSwitchHotspot /> }
          { MockDebugPanel && <Suspense fallback={ null }><MockDebugPanel /></Suspense> }
        </RouterProvider>
      </div>
    </AnimatePresence>
  )
}

function GlobalDebugRouter() {
  ;(window as any).$router = router
  return null
}

export default App

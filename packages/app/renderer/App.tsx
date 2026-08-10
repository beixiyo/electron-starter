import { Outlet, RouterProvider } from '@jl-org/react-router'
import { useTheme } from 'hooks'
import { AnimatePresence } from 'motion/react'
import { UpdaterModal } from '@/components/updater'
import { router } from '@/router'
import { useShortcutRuntime } from '@/shortcuts'
import { initUpdaterStore } from '@/store/updaterStore'

function App() {
  useTheme()
  useShortcutRuntime()

  /** 订阅主进程更新事件（一次）：后台轮询发现新版本时驱动全局更新弹窗 */
  useEffect(() => {
    initUpdaterStore()
  }, [])

  return <AnimatePresence>
    <div className="min-h-full bg-background text-textPrimary">
      <RouterProvider router={ router }>
        <GlobalDebugRouter />
        <Outlet />

        <UpdaterModal />
      </RouterProvider>
    </div>
  </AnimatePresence>
}

function GlobalDebugRouter() {
  (window as any).$router = router
  return null
}

export default App

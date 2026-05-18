import { Outlet, RouterProvider } from '@jl-org/react-router'
import { AnimatePresence } from 'motion/react'
import { useTheme } from 'hooks'
import { router } from './router'

function App() {
  useTheme()

  return <AnimatePresence>
    <div className="min-h-full bg-background text-textPrimary">
      <RouterProvider router={ router }>
        <GlobalDebugRouter />
        <Outlet />
      </RouterProvider>
    </div>
  </AnimatePresence>
}

function GlobalDebugRouter() {
  (window as any).$router = router
  return null
}

export default App

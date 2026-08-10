import { createRoot } from 'react-dom/client'
import { AppErrorBoundary } from '@/components/AppErrorBoundary'
import { initRendererDiagnostics } from '@/logging'
import { useShortcutRuntime } from '@/shortcuts/useShortcutRuntime'

import { ScreenshotApp } from './ScreenshotApp'
import 'styles/css/index.css'

initRendererDiagnostics()

function ShortcutRuntimeScreenshotApp() {
  useShortcutRuntime()
  return <ScreenshotApp />
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary className="min-h-screen bg-transparent">
    <ShortcutRuntimeScreenshotApp />
  </AppErrorBoundary>,
)

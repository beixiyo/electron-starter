import { createRoot } from 'react-dom/client'
import { AppErrorBoundary } from '@/components/AppErrorBoundary'
import { initRendererDiagnostics } from '@/logging'

import { ScreenshotApp } from './ScreenshotApp'
import 'styles/css/index.css'

initRendererDiagnostics()

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary className="min-h-screen bg-transparent">
    <ScreenshotApp />
  </AppErrorBoundary>,
)

import { createRoot } from 'react-dom/client'
import { AppErrorBoundary } from '@/components/AppErrorBoundary'

import { ScreenshotApp } from './ScreenshotApp'
import 'styles/css/index.css'

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary className="min-h-screen bg-transparent">
    <ScreenshotApp />
  </AppErrorBoundary>,
)

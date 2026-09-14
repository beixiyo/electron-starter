/** Window Lab 独立开发入口。 */

import { AppErrorBoundary } from '@/components/AppErrorBoundary'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import '@/tailwind.css'
import { parseWindowLabPreview } from './preview'
import { WindowLabApp } from './WindowLabApp'

const rootElement = document.getElementById('root')!
const hotState = globalThis as typeof globalThis & { __windowLabControlRoot?: Root }
const root = hotState.__windowLabControlRoot ?? createRoot(rootElement)
hotState.__windowLabControlRoot = root

root.render(
  <AppErrorBoundary scope="window-lab-root">
    <WindowLabApp initialPreview={ parseWindowLabPreview(window.location.search) } />
  </AppErrorBoundary>,
)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    root.unmount()
    delete hotState.__windowLabControlRoot
  })
}

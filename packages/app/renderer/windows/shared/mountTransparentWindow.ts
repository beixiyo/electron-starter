import type { ReactNode } from 'react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { AppErrorBoundary } from '@/components/AppErrorBoundary'
import { initRendererDiagnostics } from '@/logging'

/**
 * 透明浮窗统一挂载入口
 *
 * 把 html / body / #root 重置为透明且不滚动，再渲染根组件，
 * 各透明窗口入口文件调用它以免逐份复制这段 bootstrap
 */
export function mountTransparentWindow(node: ReactNode): void {
  initRendererDiagnostics()

  document.documentElement.style.background = 'transparent'
  document.documentElement.style.overflow = 'hidden'
  document.body.style.background = 'transparent'
  document.body.style.overflow = 'hidden'

  const root = document.getElementById('root')!
  root.style.background = 'transparent'

  createRoot(root).render(
    createElement(
      AppErrorBoundary,
      { className: 'min-h-screen bg-transparent' },
      node,
    ),
  )
}

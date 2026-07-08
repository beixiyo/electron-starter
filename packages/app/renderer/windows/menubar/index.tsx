import { SHADOW_INSET, WindowType } from '@shared'
import { useTheme } from 'hooks'
import { createRoot } from 'react-dom/client'
import { cn } from 'utils'
import { AppErrorBoundary } from '@/components/AppErrorBoundary'
import { getInsetWindowHitTestRegion, useRoundedWindowHitTest } from '../shared'

import 'styles/css/index.css'

function MenuBarApp() {
  useTheme()
  useRoundedWindowHitTest(WindowType.MENUBAR, () => [
    getInsetWindowHitTestRegion(SHADOW_INSET, 16),
  ])

  const showWindow = async (type: WindowType) => {
    const { exists } = await window.$ipc.window.exists(type)
    if (!exists)
      await window.$ipc.window.create(type)
    window.$ipc.window.show(type)
  }

  return (
    <main
      className="h-screen w-screen bg-transparent"
      style={ { padding: SHADOW_INSET } }
    >
      <div className={ cn(
        'flex h-full w-full select-none flex-col gap-3 overflow-hidden rounded-2xl p-4',
        'bg-background text-text',
        'shadow-[0_2px_8px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]',
      ) }>
        <h2 className="text-sm font-semibold">Electron Starter</h2>

        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={ () => showWindow(WindowType.MAIN) }
            className={ cn(
              'text-left px-3 py-1.5 rounded-lg text-sm',
              'hover:bg-background2 transition-colors cursor-pointer',
            ) }
          >
            Open Main Window
          </button>

          <button
            type="button"
            onClick={ () => showWindow(WindowType.VOICE_IME) }
            className={ cn(
              'text-left px-3 py-1.5 rounded-lg text-sm',
              'hover:bg-background2 transition-colors cursor-pointer',
            ) }
          >
            Voice IME
          </button>

          <button
            type="button"
            onClick={ () => showWindow(WindowType.SHORTCUT_TEST) }
            className={ cn(
              'text-left px-3 py-1.5 rounded-lg text-sm',
              'hover:bg-background2 transition-colors cursor-pointer',
            ) }
          >
            Shortcut Test
          </button>
        </div>
      </div>
    </main>
  )
}

document.documentElement.style.background = 'transparent'
document.documentElement.style.overflow = 'hidden'
document.body.style.background = 'transparent'
document.body.style.overflow = 'hidden'
document.getElementById('root')!.style.background = 'transparent'

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary className="min-h-screen bg-transparent">
    <MenuBarApp />
  </AppErrorBoundary>,
)

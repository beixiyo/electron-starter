import { WindowType } from '@shared'
import { useTheme } from 'hooks'
import { createRoot } from 'react-dom/client'
import { cn } from 'utils'

import 'styles/css/index.css'

function MenuBarApp() {
  useTheme()

  const showWindow = async (type: WindowType) => {
    const { exists } = await window.$ipc.window.exists(type)
    if (!exists)
      await window.$ipc.window.create(type)
    window.$ipc.window.show(type)
  }

  return (
    <div className={ cn(
      'flex flex-col gap-3 p-4',
      'bg-background text-text',
      'h-full w-full select-none',
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
  )
}

createRoot(document.getElementById('root')!).render(
  <MenuBarApp />,
)

import { SHADOW_INSET, WindowType } from '@shared'
import { useTheme } from 'hooks'
import { useEffect, useSyncExternalStore } from 'react'
import { initVoiceImeStore, voiceImeStore } from '@/store/voiceImeStore'
import { createRoot } from 'react-dom/client'
import { cn } from 'utils'
import { AppErrorBoundary } from '@/components/AppErrorBoundary'
import { initRendererDiagnostics } from '@/logging'
import { useShortcutRuntime } from '@/shortcuts/useShortcutRuntime'
import { getInsetWindowHitTestRegion, useRoundedWindowHitTest, WINDOW_SURFACE_SHADOW } from '../shared'

import 'styles/css/index.css'

initRendererDiagnostics()

function MenuBarApp() {
  useTheme()
  useShortcutRuntime()
  useEffect(() => initVoiceImeStore(), [])
  const voiceState = useSyncExternalStore(voiceImeStore.subscribe, voiceImeStore.getSnapshot)
  useRoundedWindowHitTest(WindowType.MENUBAR, () => [
    getInsetWindowHitTestRegion(SHADOW_INSET, 16),
  ])

  const showWindow = async (type: WindowType) => {
    const { exists } = await window.$ipc.window.exists(type)
    if (!exists)
      await window.$ipc.window.create(type)
    window.$ipc.window.show(type)
  }

  const startVoiceInput = async () => {
    try {
      const state = await window.$ipc.voiceIme.getActiveState()
      if (state.phase === 'recording' && state.sessionId) await window.$ipc.voiceIme.stopSession(state.sessionId)
      else if (state.phase === 'idle') await window.$ipc.voiceIme.startClickMode()
      else return
      await window.$ipc.window.hide(WindowType.MENUBAR)
    }
    catch (error) {
      console.error('[voice-ime] failed to start from menu', error)
    }
  }

  return (
    <main
      className="h-screen w-screen bg-transparent"
      style={ { padding: SHADOW_INSET } }
    >
      <div className={ cn(
        'flex h-full w-full select-none flex-col gap-3 overflow-hidden rounded-2xl p-4',
        'bg-background text-text',
        WINDOW_SURFACE_SHADOW,
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
            onClick={ startVoiceInput }
            disabled={ voiceState.phase === 'processing' }
            className={ cn(
              'text-left px-3 py-1.5 rounded-lg text-sm',
              'hover:bg-background2 transition-colors cursor-pointer',
            ) }
          >
            { voiceState.phase === 'recording'
              ? 'Finish Voice Input'
              : voiceState.phase === 'processing'
                ? 'Processing Voice Input'
                : 'Start Voice Input' }
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
  <AppErrorBoundary scope="menubar-window-root" className="min-h-screen bg-transparent">
    <MenuBarApp />
  </AppErrorBoundary>,
)

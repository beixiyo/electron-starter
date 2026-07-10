import type {
  KeyboardShortcutChord,
  ShortcutBinding,
  ShortcutBindings,
  ShortcutGestureRuntimeEntry,
  ShortcutRuntimeCapabilities,
  ShortcutRuntimeEvent,
} from '@shared/shortcuts'
import {
  createShortcutGestureEngine,
  isShortcutBindingSupported,
  toBrowserShortcutRecordEvent,
} from '@shared/shortcuts'
import { useEffect, useRef } from 'react'
import {
  getShortcutBindings,
  getShortcutCapabilities,
  isShortcutRuntimePaused,
  subscribeShortcutBindings,
} from './shortcutConfigAdapter'

export function useShortcutRuntime(handlers: ShortcutRuntimeHandlers): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    let disposed = false
    let reloadVersion = 0
    let runtime: BrowserShortcutRuntime | null = null

    const reload = async () => {
      const version = ++reloadVersion
      const [bindings, capabilities] = await Promise.all([
        getShortcutBindings(),
        getShortcutCapabilities(),
      ])

      if (disposed || version !== reloadVersion)
        return

      runtime?.dispose()
      runtime = createBrowserShortcutRuntime(bindings, capabilities, (event) => {
        handlersRef.current[event.id]?.(event)
      })
    }

    void reload()
    const unsubscribe = subscribeShortcutBindings(() => {
      void reload()
    })

    return () => {
      disposed = true
      unsubscribe()
      runtime?.dispose()
    }
  }, [])
}

function createBrowserShortcutRuntime(
  bindings: ShortcutBindings,
  capabilities: ShortcutRuntimeCapabilities,
  emit: (event: ShortcutRuntimeEvent) => void,
): BrowserShortcutRuntime {
  const shortcuts = createBrowserShortcutEntries(bindings, capabilities)
  const activeChords = new Map<string, KeyboardShortcutChord>()
  const engine = createShortcutGestureEngine({
    entries: shortcuts,
    isPaused: isShortcutRuntimePaused,
    emit,
  })

  const handleKeyDown = (event: KeyboardEvent) => {
    if (isShortcutRuntimePaused()) {
      clearState()
      return
    }

    const recordEvent = toBrowserShortcutRecordEvent(event, 'down', activeChords)
    if (!recordEvent)
      return

    if (engine.handle(recordEvent)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const handleKeyUp = (event: KeyboardEvent) => {
    if (isShortcutRuntimePaused()) {
      clearState()
      return
    }

    const recordEvent = toBrowserShortcutRecordEvent(event, 'up', activeChords)
    if (!recordEvent)
      return

    if (engine.handle(recordEvent)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const clearState = () => {
    engine.clear()
    activeChords.clear()
  }

  window.addEventListener('keydown', handleKeyDown, true)
  window.addEventListener('keyup', handleKeyUp, true)

  return {
    dispose() {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      engine.dispose()
      activeChords.clear()
    },
  }
}

function createBrowserShortcutEntries(
  bindings: ShortcutBindings,
  capabilities: ShortcutRuntimeCapabilities,
): BrowserShortcutEntry[] {
  return Object.entries(bindings).flatMap(([id, binding]) => {
    if (!isBrowserRuntimeBinding(binding, capabilities))
      return []

    return [{ id, binding }]
  })
}

function isBrowserRuntimeBinding(
  binding: ShortcutBinding | null,
  capabilities: ShortcutRuntimeCapabilities,
): binding is ShortcutBinding & { chord: KeyboardShortcutChord } {
  return !!binding
    && binding.scope === 'local'
    && binding.chord.source === 'keyboard'
    && isShortcutBindingSupported(binding, capabilities)
}

type BrowserShortcutRuntime = {
  dispose: () => void
}

type BrowserShortcutEntry = ShortcutGestureRuntimeEntry<ShortcutBinding & { chord: KeyboardShortcutChord }>

/** action id → runtime 事件处理器 */
export type ShortcutRuntimeHandlers = Partial<Record<string, (event: ShortcutRuntimeEvent) => void>>

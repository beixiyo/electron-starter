import type {
  FnShortcutChord,
  ShortcutBinding,
  ShortcutGestureRuntimeEntry,
  ShortcutRecordEvent,
  ShortcutRuntimeEvent,
} from '@shared/shortcuts'
import type {
  ShortcutRuntimeBackend,
  ShortcutRuntimeBackendContext,
  ShortcutRuntimeEntry,
} from '../runtime-backend'
import { createShortcutGestureEngine } from '@shared/shortcuts'
import { canUseFnShortcutBackend } from '../capabilities'
import { FN_SHORTCUT_RUNTIME_PROVIDER } from '../providers'
import { getShortcutRuntimeEntries } from '../runtime-backend'
import { isShortcutRuntimeSuspended } from '../suspension'
import { addFnRawEventListener, startFnKeyListener, stopFnKeyListener } from './core'

type FnBinding = ShortcutBinding & { chord: FnShortcutChord }
type FnRuntimeEntry = ShortcutRuntimeEntry<FnBinding>

let registeredEntries = new Map<string, FnRuntimeEntry>()
let removeRawListener: (() => void) | null = null
let runtimeContext: ShortcutRuntimeBackendContext | null = null

const gestureEngine = createShortcutGestureEngine<FnBinding>({
  entries: [],
  isPaused: isShortcutRuntimeSuspended,
  emit: emitFnGestureEvent,
})

export const fnShortcutRuntimeBackend: ShortcutRuntimeBackend = {
  ...FN_SHORTCUT_RUNTIME_PROVIDER,
  reset: resetFnRuntime,
  sync: syncFnListenerRuntime,
  apply(bindings, context) {
    resetFnRuntime()
    runtimeContext = context
    const entries = getShortcutRuntimeEntries(bindings, context, isFnBinding)
    registeredEntries = new Map(entries.map(entry => [entry.id, entry]))
    gestureEngine.updateEntries(entries.map(toGestureEntry))
    removeRawListener = addFnRawEventListener(handleFnRawEvent)
  },
}

function resetFnRuntime(): void {
  removeRawListener?.()
  removeRawListener = null
  gestureEngine.updateEntries([])
  registeredEntries.clear()
  runtimeContext = null
}

function syncFnListenerRuntime(): void {
  if (process.platform !== 'darwin')
    return

  if (canUseFnShortcutBackend()) {
    startFnKeyListener()
    return
  }

  stopFnKeyListener()
}

function handleFnRawEvent(event: Parameters<Parameters<typeof addFnRawEventListener>[0]>[0]): void {
  if (event.type === 'reset') {
    gestureEngine.cancelActiveGestures()
    return
  }

  if (event.phase === 'down' && event.chord.key !== 'Fn') {
    gestureEngine.cancelChord({ source: 'fn', key: 'Fn' })
  }

  const recordEvent: ShortcutRecordEvent = {
    phase: event.phase,
    chord: event.chord,
    timestamp: event.timestamp,
  }
  gestureEngine.handle(recordEvent)
}

function emitFnGestureEvent(event: ShortcutRuntimeEvent & { binding: FnBinding }): void {
  const entry = registeredEntries.get(event.id)
  const context = runtimeContext
  if (!entry || !context)
    return
  if (event.phase === 'trigger' && !context.canTrigger(entry.binding))
    return

  context.emit({ ...entry, phase: event.phase, gesture: event.gesture })
}

function toGestureEntry(entry: FnRuntimeEntry): ShortcutGestureRuntimeEntry<FnBinding> {
  return {
    id: entry.id,
    binding: entry.binding,
    canStart: () => runtimeContext?.canTrigger(entry.binding) ?? false,
  }
}

function isFnBinding(binding: ShortcutBinding | null): binding is FnBinding {
  return !!binding && binding.chord.source === 'fn'
}

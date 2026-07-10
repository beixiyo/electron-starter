import type {
  FnComboKey,
  FnModifier,
  FnShortcutChord,
  ShortcutBinding,
  ShortcutBindings,
  ShortcutModifier,
} from '@shared/shortcuts'
import type {
  ShortcutRuntimeBackend,
  ShortcutRuntimeBackendContext,
  ShortcutRuntimeEntry,
} from '../runtime-backend'
import type { FnShortcutsConfig } from './types'
import { normalizeShortcutModifiers } from '@shared/shortcuts'
import { canUseFnShortcutBackend } from '../capabilities'
import { FN_SHORTCUT_RUNTIME_PROVIDER } from '../providers'
import { getShortcutRuntimeEntries } from '../runtime-backend'
import { startFnKeyListener, stopFnKeyListener } from './core'
import { registerFnShortcuts, resetShortcutHandlers } from './state-machine'

export const fnShortcutRuntimeBackend: ShortcutRuntimeBackend = {
  ...FN_SHORTCUT_RUNTIME_PROVIDER,
  reset: resetShortcutHandlers,
  sync: syncFnListenerRuntime,
  apply(bindings, context) {
    registerFnShortcutBindings(bindings, context)
  },
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

function registerFnShortcutBindings(
  bindings: ShortcutBindings,
  context: ShortcutRuntimeBackendContext,
): void {
  if (process.platform !== 'darwin')
    return

  let holdEntry: FnRuntimeEntry | null = null
  let doublePressEntry: FnRuntimeEntry | null = null

  const entries = getShortcutRuntimeEntries(bindings, context, isFnBinding)
  const combos = entries.flatMap((entry) => {
    const { binding } = entry
    if (binding.chord.key === 'Fn') {
      if (binding.gesture === 'hold')
        holdEntry = entry
      if (binding.gesture === 'doublePress')
        doublePressEntry = entry
      return []
    }

    if (binding.gesture !== 'press' && binding.gesture !== 'doublePress')
      return []

    const { key, modifiers } = binding.chord
    return [{
      key: key as FnComboKey,
      modifiers: normalizeFnModifiers(modifiers),
      gesture: binding.gesture,
      intervalMs: binding.intervalMs,
      onTrigger: () => {
        if (!context.canTrigger(binding))
          return

        context.emit({
          ...entry,
          phase: 'trigger',
          gesture: binding.gesture,
        })
      },
    }]
  })

  registerFnShortcuts({
    hold: holdEntry
      ? createFnHoldShortcutConfig(holdEntry, context)
      : undefined,
    doublePress: doublePressEntry
      ? createFnDoublePressShortcutConfig(doublePressEntry, context)
      : undefined,
    combos,
  })
}

function createFnHoldShortcutConfig(
  entry: FnRuntimeEntry,
  context: ShortcutRuntimeBackendContext,
): NonNullable<FnShortcutsConfig['hold']> {
  const { binding } = entry

  return {
    canStart: () => context.canTrigger(binding),
    onStart: () => context.emit({
      ...entry,
      phase: 'trigger',
      gesture: 'hold',
    }),
    onRelease: () => context.emit({
      ...entry,
      phase: 'release',
      gesture: 'hold',
    }),
  }
}

function createFnDoublePressShortcutConfig(
  entry: FnRuntimeEntry,
  context: ShortcutRuntimeBackendContext,
): NonNullable<FnShortcutsConfig['doublePress']> {
  const { binding } = entry

  return {
    onTrigger: () => {
      if (!context.canTrigger(binding))
        return

      context.emit({
        ...entry,
        phase: 'trigger',
        gesture: 'doublePress',
      })
    },
  }
}

function isFnBinding(
  binding: ShortcutBinding | null,
): binding is ShortcutBinding & { chord: FnShortcutChord } {
  return !!binding && binding.chord.source === 'fn'
}

function normalizeFnModifiers(modifiers: ShortcutModifier[] | undefined): FnModifier[] {
  return normalizeShortcutModifiers(modifiers ?? [])
}

type FnRuntimeEntry = ShortcutRuntimeEntry<ShortcutBinding & { chord: FnShortcutChord }>

import type { KeyboardShortcutChord, ShortcutBinding, ShortcutBindings } from '@shared/shortcuts'
import type { ShortcutRuntimeBackend, ShortcutRuntimeBackendContext } from '../runtime-backend'
import { KEYBOARD_SHORTCUT_RUNTIME_PROVIDER } from '../providers'
import { getShortcutRuntimeEntries } from '../runtime-backend'
import {
  registerKeyboardGestureShortcut,
  unregisterKeyboardGestureShortcuts,
} from './gesture'

export const keyboardShortcutRuntimeBackend: ShortcutRuntimeBackend = {
  ...KEYBOARD_SHORTCUT_RUNTIME_PROVIDER,
  reset: unregisterKeyboardGestureShortcuts,
  apply(bindings, context) {
    registerKeyboardShortcutBindings(bindings, context)
  },
}

function registerKeyboardShortcutBindings(
  bindings: ShortcutBindings,
  context: ShortcutRuntimeBackendContext,
): void {
  const entries = getShortcutRuntimeEntries(bindings, context, isKeyboardBinding)

  for (const entry of entries) {
    const { id, binding } = entry
    registerKeyboardGestureShortcut({
      id,
      binding,
      canStart: () => context.canTrigger(binding),
      onTrigger: (gesture) => {
        context.emit({
          ...entry,
          phase: 'trigger',
          gesture,
        })
      },
      onRelease: (gesture) => {
        context.emit({
          ...entry,
          phase: 'release',
          gesture,
        })
      },
    })
  }
}

function isKeyboardBinding(
  binding: ShortcutBinding | null,
): binding is ShortcutBinding & { chord: KeyboardShortcutChord } {
  return !!binding && binding.scope === 'global' && binding.chord.source === 'keyboard'
}

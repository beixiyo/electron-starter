import type { ShortcutBindings } from '@shared/shortcuts'
import { DEFAULT_BINDINGS, normalizeShortcutBindings, resolveShortcutBindingConflicts } from '@shared/shortcuts'
import { createStore } from '.'

const store = createStore<ShortcutBindings>('shortcut-bindings.json', DEFAULT_BINDINGS)

export function readShortcutBindings(): ShortcutBindings {
  return resolveShortcutBindingConflicts(normalizeShortcutBindings(store.read()))
}

export function writeShortcutBindings(bindings: ShortcutBindings): void {
  store.write(resolveShortcutBindingConflicts(normalizeShortcutBindings(bindings)))
}

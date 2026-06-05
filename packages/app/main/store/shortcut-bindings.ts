import type { ShortcutBindings } from '@ipc/services/shortcut-config/contract'
import { DEFAULT_BINDINGS } from '@ipc/services/shortcut-config/contract'
import { createStore } from '.'

const store = createStore<ShortcutBindings>('shortcut-bindings.json', DEFAULT_BINDINGS)

export const readShortcutBindings = store.read
export const writeShortcutBindings = store.write

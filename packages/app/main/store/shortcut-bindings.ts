import type { ShortcutBindings } from '@shared/shortcuts'
import {
  DEFAULT_BINDINGS,
  normalizeShortcutBindings,
  normalizeShortcutBindingsOrThrow,
  resolveShortcutBindingConflicts,
  SHORTCUT_ACTIONS,
} from '@shared/shortcuts'
import { createStore } from '.'

const store = createStore<ShortcutBindings>('shortcut-bindings.json', DEFAULT_BINDINGS)
const SHORTCUT_ACTION_IDS: ReadonlySet<string> = new Set(SHORTCUT_ACTIONS.map(action => action.id))

export function readShortcutBindings(): ShortcutBindings {
  return finalizeShortcutBindings(normalizeShortcutBindings(store.read()))
}

export function writeShortcutBindings(bindings: ShortcutBindings): void {
  store.write(bindings)
}

/** 校验 renderer 写入，并以 action 定义重建 scope */
export function normalizeShortcutBindingsForWrite(value: unknown): ShortcutBindings {
  assertKnownShortcutActionIds(value)
  return finalizeShortcutBindings(normalizeShortcutBindingsOrThrow(value))
}

function finalizeShortcutBindings(normalized: ShortcutBindings): ShortcutBindings {
  const next: ShortcutBindings = { ...DEFAULT_BINDINGS }

  for (const action of SHORTCUT_ACTIONS) {
    if (!(action.id in normalized))
      continue

    const binding = normalized[action.id]
    next[action.id] = binding
      ? { ...binding, scope: action.scope }
      : null
  }

  return resolveShortcutBindingConflicts(next)
}

function assertKnownShortcutActionIds(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('Shortcut bindings must be an object')

  const unknownIds = Object.keys(value).filter(id => !SHORTCUT_ACTION_IDS.has(id))
  if (unknownIds.length > 0)
    throw new Error(`未知快捷键动作标识：${unknownIds.join(', ')}`)
}

import type { ShortcutAction, ShortcutBinding } from './types'
import { useState } from 'react'
import { DEFAULT_ACTIONS } from './types'

const STORAGE_KEY = 'fn-shortcut-bindings'

function loadActions(): ShortcutAction[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored)
      return DEFAULT_ACTIONS

    const parsed = JSON.parse(stored) as Record<string, ShortcutBinding | null>
    return DEFAULT_ACTIONS.map(action => ({
      ...action,
      binding: action.id in parsed
        ? parsed[action.id]
        : action.binding,
    }))
  }
  catch {
    return DEFAULT_ACTIONS
  }
}

function persistActions(actions: ShortcutAction[]): void {
  const map = Object.fromEntries(actions.map(a => [a.id, a.binding]))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

export function useShortcutsList() {
  const [actions, setActions] = useState<ShortcutAction[]>(loadActions)

  const updateBinding = (id: string, binding: ShortcutBinding | null) => {
    setActions((prev) => {
      const next = prev.map(a => (a.id === id
        ? { ...a, binding }
        : a))
      persistActions(next)
      return next
    })
  }

  const resetToDefault = (id: string) => {
    const def = DEFAULT_ACTIONS.find(a => a.id === id)
    if (def)
      updateBinding(id, def.binding)
  }

  return { actions, updateBinding, resetToDefault }
}

import type { ShortcutScope } from '@shared/shortcuts'
import type { ShortcutAction, ShortcutBinding } from './types'
import { useLatestCallback } from 'hooks'
import { useEffect, useState } from 'react'
import { getShortcutBindings, getShortcutDefaultBindings, setShortcutBindings } from '@/shortcuts/shortcutConfigAdapter'
import { bindingsConflict, DEFAULT_ACTIONS } from './types'

export function useShortcutsList() {
  const [defaultActions, setDefaultActions] = useState<ShortcutAction[]>(
    () => DEFAULT_ACTIONS.map(a => ({ ...a })),
  )
  const [actions, setActions] = useState<ShortcutAction[]>(
    () => DEFAULT_ACTIONS.map(a => ({ ...a })),
  )

  useEffect(() => {
    let disposed = false

    Promise.all([
      getShortcutDefaultBindings(),
      getShortcutBindings(),
    ]).then(([defaultBindings, bindings]) => {
      if (disposed)
        return

      const nextDefaultActions = DEFAULT_ACTIONS.map(a => ({
        ...a,
        binding: a.id in defaultBindings
          ? defaultBindings[a.id]
          : a.binding,
      }))

      setDefaultActions(nextDefaultActions)
      setActions(nextDefaultActions.map(a => ({
        ...a,
        binding: a.id in bindings
          ? bindings[a.id]
          : a.binding,
      })))
    })

    return () => {
      disposed = true
    }
  }, [])

  const updateBinding = useLatestCallback((id: string, binding: ShortcutBinding | null) => {
    setActions((prev) => {
      const next = prev.map(a => a.id === id
        ? { ...a, binding }
        : a)
      void setShortcutBindings(
        Object.fromEntries(next.map(a => [a.id, a.binding])),
      )
      return next
    })
  })

  const replaceBinding = useLatestCallback((id: string, binding: ShortcutBinding) => {
    setActions((prev) => {
      const next = prev.map((action) => {
        if (action.id === id)
          return { ...action, binding }

        if (action.binding && bindingsConflict(binding, action.binding))
          return { ...action, binding: null }

        return action
      })

      void persistBindings(next)
      return next
    })
  })

  const updateBindingScope = useLatestCallback((id: string, scope: ShortcutScope) => {
    setActions((prev) => {
      const next = prev.map(a => a.id === id && a.binding
        ? { ...a, binding: { ...a.binding, scope } }
        : a)

      void setShortcutBindings(
        Object.fromEntries(next.map(a => [a.id, a.binding])),
      )
      return next
    })
  })

  const resetToDefault = useLatestCallback((id: string) => {
    const def = defaultActions.find(a => a.id === id)
    if (def)
      updateBinding(id, def.binding)
  })

  return { actions, updateBinding, replaceBinding, updateBindingScope, resetToDefault }
}

function persistBindings(actions: ShortcutAction[]): Promise<void> {
  return setShortcutBindings(
    Object.fromEntries(actions.map(action => [action.id, action.binding])),
  )
}

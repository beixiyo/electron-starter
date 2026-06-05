import type { ShortcutAction, ShortcutBinding } from './types'
import { useLatestCallback } from 'hooks'
import { useEffect, useState } from 'react'
import { DEFAULT_ACTIONS } from './types'

export function useShortcutsList() {
  const [actions, setActions] = useState<ShortcutAction[]>(
    () => DEFAULT_ACTIONS.map(a => ({ ...a })),
  )

  useEffect(() => {
    window.$ipc.shortcutConfig.getBindings().then((bindings) => {
      setActions(DEFAULT_ACTIONS.map(a => ({
        ...a,
        binding: a.id in bindings
          ? bindings[a.id]
          : a.binding,
      })))
    })
  }, [])

  const updateBinding = useLatestCallback((id: string, binding: ShortcutBinding | null) => {
    setActions((prev) => {
      const next = prev.map(a => a.id === id
        ? { ...a, binding }
        : a)
      window.$ipc.shortcutConfig.setBindings(
        Object.fromEntries(next.map(a => [a.id, a.binding])),
      )
      return next
    })
  })

  const resetToDefault = useLatestCallback((id: string) => {
    const def = DEFAULT_ACTIONS.find(a => a.id === id)
    if (def)
      updateBinding(id, def.binding)
  })

  return { actions, updateBinding, resetToDefault }
}

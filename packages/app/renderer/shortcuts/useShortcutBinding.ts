import type { ShortcutBinding } from '@shared/shortcuts'
import { useEffect, useState } from 'react'
import { getShortcutBindings, subscribeShortcutBindings } from './shortcutConfigAdapter'

/** 订阅某个动作当前生效的绑定，供快捷键说明文字保持同步。 */
export function useShortcutBinding(actionId: string): ShortcutBinding | null {
  const [binding, setBinding] = useState<ShortcutBinding | null>(null)

  useEffect(() => {
    let disposed = false
    let loadSequence = 0

    const load = () => {
      const sequence = ++loadSequence
      void getShortcutBindings().then((bindings) => {
        if (!disposed && sequence === loadSequence) setBinding(bindings[actionId] ?? null)
      }).catch(() => {
        if (!disposed && sequence === loadSequence) setBinding(null)
      })
    }

    load()
    const unsubscribe = subscribeShortcutBindings(load)
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [actionId])

  return binding
}

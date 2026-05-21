import type { FocusDemoPayload } from '@ipc/services/focus-demo/contract'
import { useEffect, useState } from 'react'

export function useFocusDemo() {
  const [focus, setFocus] = useState<FocusDemoPayload | null>(null)

  useEffect(() => {
    return $ipc.focusDemo.on('update', setFocus)
  }, [])

  return { focus }
}

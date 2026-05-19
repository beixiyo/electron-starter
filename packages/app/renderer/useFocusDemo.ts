import type { FocusDemoPayload } from '@shared'
import { useEffect, useState } from 'react'

export function useFocusDemo() {
  const [focus, setFocus] = useState<FocusDemoPayload | null>(null)

  useEffect(() => {
    return $ipc.focusDemo.onUpdate(setFocus)
  }, [])

  return { focus }
}

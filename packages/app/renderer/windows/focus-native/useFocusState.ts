import type { FocusPayload } from '@ipc/services/focus/contract'
import { useEffect, useState } from 'react'

export function useFocusState(initialFocus: FocusPayload | null = null): UseFocusStateReturn {
  const [focus, setFocus] = useState<FocusPayload | null>(initialFocus)

  useEffect(() => {
    return $ipc.focus.on('update', setFocus)
  }, [])

  return { focus }
}

type UseFocusStateReturn = {
  focus: FocusPayload | null
}

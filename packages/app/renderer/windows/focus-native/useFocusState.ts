import type { FocusPayload } from '@ipc/services/focus/contract'
import { useEffect, useState } from 'react'

export function useFocusState(): UseFocusStateReturn {
  const [focus, setFocus] = useState<FocusPayload | null>(null)

  useEffect(() => {
    return $ipc.focus.on('update', setFocus)
  }, [])

  return { focus }
}

type UseFocusStateReturn = {
  focus: FocusPayload | null
}

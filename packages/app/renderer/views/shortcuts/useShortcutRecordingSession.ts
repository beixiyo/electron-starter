import type { ShortcutScope } from '@shared/shortcuts'
import type { ShortcutAction, ShortcutBinding } from './types'
import type { useRecordBinding } from './useRecordBinding'
import { canUseShortcutScope } from '@shared/shortcuts'
import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'
import { getShortcutCapabilities, pauseShortcutRecord, resumeShortcutRecord } from '@/shortcuts/shortcutConfigAdapter'

type ShortcutRecorder = ReturnType<typeof useRecordBinding>

export function useShortcutRecordingSession(
  actions: ShortcutAction[],
  recorder: ShortcutRecorder,
  replaceBinding: (id: string, binding: ShortcutBinding) => void,
) {
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [recordingScope, setRecordingScope] = useState<ShortcutScope>('local')
  const [canUseGlobalScope, setCanUseGlobalScope] = useState(false)
  const mountedRef = useRef(true)
  const recorderRef = useRef(recorder)
  const recordStartSeqRef = useRef(0)

  recorderRef.current = recorder

  useEffect(() => {
    let disposed = false

    void getShortcutCapabilities().then((capabilities) => {
      if (!disposed)
        setCanUseGlobalScope(canUseShortcutScope(capabilities, 'global'))
    })

    return () => {
      disposed = true
    }
  }, [])

  const resolveScope = useLatestCallback((scope: ShortcutScope): ShortcutScope => {
    return canUseGlobalScope ? scope : 'local'
  })

  const defaultScope: ShortcutScope = canUseGlobalScope ? 'global' : 'local'

  const start = useLatestCallback((id: string) => {
    if (recordingId)
      return

    const action = actions.find(item => item.id === id)
    if (!action)
      return

    const sequence = ++recordStartSeqRef.current
    void pauseShortcutRecord()
      .then(() => {
        if (!mountedRef.current || sequence !== recordStartSeqRef.current) {
          void resumeShortcutRecord()
          return
        }

        setRecordingId(id)
        setRecordingScope(resolveScope(action.binding?.scope ?? defaultScope))
        recorder.start(action.supportedGestures)
      })
      .catch(() => {
        void resumeShortcutRecord()
      })
  })

  const cancel = useLatestCallback(() => {
    recordStartSeqRef.current++
    recorder.cancel()
    setRecordingId(null)
    void resumeShortcutRecord()
  })

  const changeScope = useLatestCallback((scope: ShortcutScope) => {
    setRecordingScope(resolveScope(scope))
  })

  const confirm = useLatestCallback(() => {
    recordStartSeqRef.current++

    const action = actions.find(item => item.id === recordingId)
    const detected = recorder.detected
    if (!action || !detected)
      return

    replaceBinding(action.id, {
      ...detected,
      scope: resolveScope(recordingScope),
    })
    cancel()
  })

  useEffect(() => {
    return () => {
      mountedRef.current = false
      recorderRef.current.cancel()
      void resumeShortcutRecord()
    }
  }, [])

  useEffect(() => {
    if (!recordingId)
      return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        cancel()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cancel, recordingId])

  return {
    recordingId,
    recordingScope,
    canUseGlobalScope,
    resolveScope,
    start,
    confirm,
    cancel,
    changeScope,
  }
}

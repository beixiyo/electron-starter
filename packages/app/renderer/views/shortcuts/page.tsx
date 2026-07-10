import type { ShortcutScope } from '@shared/shortcuts'
import { canUseShortcutScope } from '@shared/shortcuts'
import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'
import { getShortcutCapabilities, pauseShortcutRecord, resumeShortcutRecord } from '@/shortcuts/shortcutConfigAdapter'
import { ShortcutRow } from './ShortcutRow'
import { bindingsConflict } from './types'
import { useRecordBinding } from './useRecordBinding'
import { useShortcutsList } from './useShortcutsList'

export default function ShortcutsPage() {
  const { actions, updateBinding, updateBindingScope, resetToDefault } = useShortcutsList()
  const recorder = useRecordBinding()
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [recordingScope, setRecordingScope] = useState<ShortcutScope>('local')
  const [canUseGlobalScope, setCanUseGlobalScope] = useState(false)
  const mountedRef = useRef(true)
  const recorderRef = useRef(recorder)
  const recordStartSeqRef = useRef(0)

  recorderRef.current = recorder

  const defaultScope: ShortcutScope = canUseGlobalScope
    ? 'global'
    : 'local'
  const resolveScope = (scope: ShortcutScope): ShortcutScope => canUseGlobalScope
    ? scope
    : 'local'

  useEffect(() => {
    let disposed = false

    getShortcutCapabilities().then((capabilities) => {
      if (disposed)
        return

      setCanUseGlobalScope(canUseShortcutScope(capabilities, 'global'))
    })

    return () => {
      disposed = true
    }
  }, [])

  const handleStart = useLatestCallback((id: string) => {
    if (recordingId)
      return

    const action = actions.find(a => a.id === id)
    if (!action)
      return

    const seq = ++recordStartSeqRef.current
    void pauseShortcutRecord()
      .then(() => {
        if (!mountedRef.current || seq !== recordStartSeqRef.current) {
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

  const handleConfirm = useLatestCallback(() => {
    recordStartSeqRef.current++

    const id = recordingId
    const binding = recorder.detected
    if (id && binding) {
      const scopedBinding = {
        ...binding,
        scope: resolveScope(recordingScope),
      }
      /** 新绑定优先：清空同 chord 下会互相抢占的绑定 */
      const evicted = actions.filter((a) => {
        if (a.id === id || !a.binding)
          return false
        return bindingsConflict(scopedBinding, a.binding)
      })
      for (const a of evicted) updateBinding(a.id, null)
      updateBinding(id, scopedBinding)
    }
    recorder.cancel()
    setRecordingId(null)
    void resumeShortcutRecord()
  })

  const handleCancel = useLatestCallback(() => {
    recordStartSeqRef.current++
    recorder.cancel()
    setRecordingId(null)
    void resumeShortcutRecord()
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
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        handleCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleCancel, recordingId])

  return (
    <div className="px-8 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-text">快捷键</h1>
        <p className="mt-1 text-sm text-text3">点击右侧按键标签录入新的快捷键</p>
      </header>

      <div className="overflow-hidden rounded-2xl border border-border bg-background">
        { actions.map((action, index) => (
          <div key={ action.id }>
            <ShortcutRow
              action={ action }
              isRecording={ recordingId === action.id && recorder.isRecording }
              isDetected={ recordingId === action.id && recorder.isDetected }
              isUnsupported={ recordingId === action.id && recorder.isUnsupported }
              scope={ recordingId === action.id
                ? recordingScope
                : resolveScope(action.binding?.scope ?? defaultScope) }
              canUseGlobalScope={ canUseGlobalScope }
              detected={ recordingId === action.id
                ? recorder.detected
                : null }
              onStartRecord={ () => handleStart(action.id) }
              onScopeChange={ (scope) => {
                const nextScope = resolveScope(scope)
                if (recordingId === action.id) {
                  setRecordingScope(nextScope)
                  return
                }
                updateBindingScope(action.id, nextScope)
              } }
              onConfirm={ handleConfirm }
              onCancel={ handleCancel }
              onReset={ () => resetToDefault(action.id) }
            />
            { index < actions.length - 1 && <div className="mx-5 h-px bg-border" /> }
          </div>
        )) }
      </div>
    </div>
  )
}

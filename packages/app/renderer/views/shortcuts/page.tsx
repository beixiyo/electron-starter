import { useLatestCallback } from 'hooks'
import { useEffect, useState } from 'react'
import { ShortcutRow } from './ShortcutRow'
import { useRecordBinding } from './useRecordBinding'
import { useShortcutsList } from './useShortcutsList'

export default function ShortcutsPage() {
  const { actions, updateBinding, resetToDefault } = useShortcutsList()
  const recorder = useRecordBinding()
  const [recordingId, setRecordingId] = useState<string | null>(null)

  const handleStart = useLatestCallback((id: string) => {
    setRecordingId(id)
    recorder.start()
  })

  const handleConfirm = useLatestCallback(() => {
    if (recordingId && recorder.detected) {
      updateBinding(recordingId, recorder.detected)
    }
    recorder.cancel()
    setRecordingId(null)
  })

  const handleCancel = useLatestCallback(() => {
    recorder.cancel()
    setRecordingId(null)
  })

  const handleReset = useLatestCallback((id: string) => {
    resetToDefault(id)
  })

  useEffect(() => {
    if (!recordingId)
      return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        handleCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [recordingId, handleCancel])

  return (
    <div className="px-8 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-text">快捷键</h1>
        <p className="mt-1 text-sm text-text3">点击右侧按键标签录入新的快捷键</p>
      </header>

      <div className="rounded-2xl border border-border bg-background overflow-hidden">
        {actions.map((action, index) => (
          <div key={ action.id }>
            <ShortcutRow
              action={ action }
              isRecording={ recordingId === action.id && recorder.isRecording }
              isDetected={ recordingId === action.id && recorder.isDetected }
              detected={ recordingId === action.id
                ? recorder.detected
                : null }
              onStartRecord={ () => handleStart(action.id) }
              onConfirm={ handleConfirm }
              onCancel={ handleCancel }
              onReset={ () => handleReset(action.id) }
            />
            {index < actions.length - 1 && (
              <div className="mx-5 h-px bg-border" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

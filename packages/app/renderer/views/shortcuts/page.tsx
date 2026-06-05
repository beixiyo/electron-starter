import type { Modifier } from '@ipc/services/fn/contract'
import { useLatestCallback } from 'hooks'
import { useEffect, useState } from 'react'
import { ShortcutRow } from './ShortcutRow'
import { useRecordBinding } from './useRecordBinding'
import { useShortcutsList } from './useShortcutsList'

function modifiersEq(a: Modifier[], b: Modifier[]): boolean {
  if (a.length !== b.length)
    return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((m, i) => m === sb[i])
}

export default function ShortcutsPage() {
  const { actions, updateBinding, resetToDefault } = useShortcutsList()
  const recorder = useRecordBinding()
  const [recordingId, setRecordingId] = useState<string | null>(null)

  const handleStart = useLatestCallback((id: string) => {
    const action = actions.find(a => a.id === id)
    if (!action)
      return
    window.$ipc.shortcutConfig.pauseForRecord()
    setRecordingId(id)
    recorder.start(action.supportedGestures)
  })

  const handleConfirm = useLatestCallback(() => {
    const id = recordingId
    const binding = recorder.detected
    if (id && binding) {
      /** 新绑定优先：hold/doublePress 全局唯一，combo key 全局唯一，清空冲突项 */
      const evicted = actions.filter((a) => {
        if (a.id === id || !a.binding)
          return false
        if (binding.type === 'hold' && a.binding.type === 'hold')
          return true
        if (binding.type === 'doublePress' && a.binding.type === 'doublePress')
          return true
        if (binding.type === 'combo' && a.binding.type === 'combo'
          && a.binding.key === binding.key
          && modifiersEq(a.binding.modifiers ?? [], binding.modifiers ?? [])) {
          return true
        }
        if (binding.type === 'hotkey' && a.binding.type === 'hotkey'
          && a.binding.key === binding.key
          && a.binding.modifiers.join() === binding.modifiers.join()) {
          return true
        }
        return false
      })
      for (const a of evicted) updateBinding(a.id, null)
      updateBinding(id, binding)
    }
    recorder.cancel()
    setRecordingId(null)
    window.$ipc.shortcutConfig.resumeAfterRecord()
  })

  const handleCancel = useLatestCallback(() => {
    recorder.cancel()
    setRecordingId(null)
    window.$ipc.shortcutConfig.resumeAfterRecord()
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
  }, [recordingId])

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
              detected={ recordingId === action.id
                ? recorder.detected
                : null }
              onStartRecord={ () => handleStart(action.id) }
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

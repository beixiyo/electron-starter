import { pauseShortcutRecord, resumeShortcutRecord } from '@/shortcuts/shortcutConfigAdapter'
import type { ShortcutChord, ShortcutGestureType, ShortcutRecordActive, ShortcutValidationCode } from '@shared/shortcuts'
import { toShortcutActionBinding, validateShortcutRecording } from '@shared/shortcuts'
import { useLatestCallback } from 'hooks'
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ShortcutAction, ShortcutBinding, ShortcutGestureBinding } from './types'
import { useRecordBinding } from './useRecordBinding'
import { useShortcutsList } from './useShortcutsList'

/** 主进程录制资源属于整个窗口；跨页面卸载重挂也必须先释放旧会话，再开启新会话 */
let recordingOperationTail: Promise<void> = Promise.resolve()

/**
 * 为快捷键页面提供跨行共享的录制状态
 *
 * 页面同时只允许一条记录进入录制；录制完成后先校验，校验通过才写入配置，失败则留在当前行继续等待
 */
export const ShortcutSettingsProvider = memo<React.PropsWithChildren>((props) => {
  const { actions, replaceBinding, clearBinding, resetToDefault, ready, saveErrorActionId } = useShortcutsList()
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [failure, setFailure] = useState<ShortcutRecordFailure | null>(null)
  const [pending, setPending] = useState(false)
  const systemShortcutsRef = useRef<ShortcutChord[]>([])
  const mountedRef = useRef(true)
  const recorderRef = useRef<ReturnType<typeof useRecordBinding> | null>(null)
  const attemptRef = useRef<RecordAttempt | null>(null)
  const committingDetectionRef = useRef<unknown>(null)
  const sequenceRef = useRef(0)

  const handleActiveChange = useLatestCallback((active: ShortcutRecordActive | null) => {
    if (active) setFailure(null)
  })
  const recorder = useRecordBinding({ onActiveChange: handleActiveChange })
  recorderRef.current = recorder

  const enqueue = useLatestCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const task = recordingOperationTail.then(operation, operation)
    recordingOperationTail = task.then(() => undefined, () => undefined)
    return task
  })

  const releaseAttempt = useLatestCallback((attempt: RecordAttempt) => {
    if (attempt.releaseRequested || attempt.released) return

    attempt.releaseRequested = true
    void enqueue(async () => {
      if (!attempt.paused) return
      try {
        await resumeShortcutRecord()
      }
      finally {
        attempt.released = true
      }
    }).catch(() => {
      attempt.released = true
    })
  })

  const stopRecord = useLatestCallback(() => {
    const attempt = attemptRef.current
    if (attempt) {
      attempt.cancelled = true
      attemptRef.current = null
      releaseAttempt(attempt)
    }

    sequenceRef.current++
    recorder.cancel()
    setRecordingId(null)
    setPending(false)
    setFailure(null)
  })

  const startRecord = useLatestCallback((id: string) => {
    if (!ready || attemptRef.current) return

    const action = actions.find((item) => item.id === id)
    if (!action) return

    const attempt: RecordAttempt = {
      sequence: ++sequenceRef.current,
      cancelled: false,
      paused: false,
      releaseRequested: false,
      released: false,
    }
    attemptRef.current = attempt
    systemShortcutsRef.current = []
    setRecordingId(id)
    setPending(true)
    setFailure(null)

    void enqueue(() => pauseShortcutRecord()).then((session) => {
      attempt.paused = true

      if (
        !mountedRef.current
        || attempt.cancelled
        || attemptRef.current !== attempt
        || sequenceRef.current !== attempt.sequence
      ) {
        releaseAttempt(attempt)
        return
      }

      systemShortcutsRef.current = session.systemShortcuts
      setPending(false)
      recorder.start(getRecordGestures(action), session)
    }).catch(() => {
      attempt.paused = false
      if (attemptRef.current !== attempt) return

      attempt.cancelled = true
      attemptRef.current = null
      setRecordingId(null)
      setPending(false)
    })
  })

  const applyDefault = useLatestCallback((id: string) => {
    const attempt = attemptRef.current
    void resetToDefault(id).then((saved) => {
      if (saved && attempt && attemptRef.current === attempt && !attempt.cancelled) stopRecord()
    })
  })

  const commit = useLatestCallback((action: ShortcutAction, detected: ShortcutGestureBinding) => {
    const binding = toShortcutActionBinding(action, detected)
    if (!binding) return

    const attempt = attemptRef.current
    void replaceBinding(action.id, binding).then((saved) => {
      if (!saved) {
        if (attempt && attemptRef.current === attempt && !attempt.cancelled) recorder.retry()
        return
      }
      if (attempt && attemptRef.current === attempt && !attempt.cancelled) stopRecord()
    })
  })

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const attempt = attemptRef.current
      if (attempt) {
        attempt.cancelled = true
        attemptRef.current = null
        releaseAttempt(attempt)
      }
      recorderRef.current?.cancel()
    }
  }, [releaseAttempt])

  /** 失焦退出录制；pending 阶段同样受保护，避免暂停完成后重新开始捕获。 */
  useEffect(() => {
    if (!recordingId) return

    const stopWhenHidden = () => {
      if (document.visibilityState === 'hidden') stopRecord()
    }
    window.addEventListener('blur', stopRecord)
    document.addEventListener('visibilitychange', stopWhenHidden)
    return () => {
      window.removeEventListener('blur', stopRecord)
      document.removeEventListener('visibilitychange', stopWhenHidden)
    }
  }, [recordingId, stopRecord])

  const { detected, retry } = recorder

  useEffect(() => {
    if (!recordingId || !detected) {
      committingDetectionRef.current = null
      return
    }
    if (committingDetectionRef.current === detected) return
    committingDetectionRef.current = detected

    const action = actions.find((item) => item.id === recordingId)
    if (!action) return

    const { binding } = detected
    const code = validateShortcutRecording({
      binding,
      actionId: action.id,
      bindings: toBindingMap(actions),
      systemShortcuts: systemShortcutsRef.current,
    })

    if (!code) {
      commit(action, binding)
      return
    }

    setFailure({ actionId: action.id, binding, code })
    retry()
  }, [actions, commit, detected, recordingId, retry])

  const value = useMemo<ShortcutSettingsContextValue>(() => ({
    actions,
    ready,
    recordingId,
    pending,
    active: recorder.active,
    failure,
    saveErrorActionId,
    startRecord,
    cancelRecord: stopRecord,
    clearBinding,
    resetToDefault: applyDefault,
  }), [actions, ready, recordingId, pending, recorder.active, failure, saveErrorActionId, startRecord, stopRecord, clearBinding, applyDefault])

  return (
    <ShortcutSettingsContext.Provider value={ value }>
      { props.children }
    </ShortcutSettingsContext.Provider>
  )
})

ShortcutSettingsProvider.displayName = 'ShortcutSettingsProvider'

/** 取全部内置动作，供页面决定渲染哪些行。 */
export function useShortcutSettingsActions(): ShortcutAction[] {
  return useContext(ShortcutSettingsContext).actions
}

/** 取一行快捷键控件需要的状态和操作。 */
export function useShortcutActionRow(id: string): ShortcutActionRow | null {
  const context = useContext(ShortcutSettingsContext)
  const action = context.actions.find((item) => item.id === id)
  if (!action) return null

  const isRecording = context.recordingId === id
  return {
    action,
    ready: context.ready,
    isRecording,
    pending: isRecording && context.pending,
    active: isRecording
      ? context.active
      : null,
    failure: isRecording && context.failure?.actionId === id
      ? context.failure
      : null,
    saveError: context.saveErrorActionId === id,
    startRecord: () => context.startRecord(id),
    cancelRecord: context.cancelRecord,
    clearBinding: () => context.clearBinding(id),
    resetToDefault: () => context.resetToDefault(id),
  }
}

const ShortcutSettingsContext = createContext<ShortcutSettingsContextValue>({
  actions: [],
  ready: false,
  recordingId: null,
  pending: false,
  active: null,
  failure: null,
  saveErrorActionId: null,
  startRecord: () => {},
  cancelRecord: () => {},
  clearBinding: () => {},
  resetToDefault: () => {},
})

function toBindingMap(actions: ShortcutAction[]): Record<string, ShortcutBinding | null> {
  return Object.fromEntries(actions.map((action) => [action.id, action.binding]))
}

type RecordAttempt = {
  sequence: number
  cancelled: boolean
  paused: boolean
  releaseRequested: boolean
  released: boolean
}

/** 一次未通过校验的录制结果，供当前行回显。 */
export type ShortcutRecordFailure = {
  actionId: string
  binding: ShortcutGestureBinding
  code: ShortcutValidationCode
}

export type ShortcutActionRow = {
  action: ShortcutAction
  ready: boolean
  isRecording: boolean
  pending: boolean
  active: ShortcutRecordActive | null
  failure: ShortcutRecordFailure | null
  saveError: boolean
  startRecord: () => void
  cancelRecord: () => void
  clearBinding: () => void
  resetToDefault: () => void
}

type ShortcutSettingsContextValue = {
  actions: ShortcutAction[]
  ready: boolean
  recordingId: string | null
  pending: boolean
  active: ShortcutRecordActive | null
  failure: ShortcutRecordFailure | null
  saveErrorActionId: string | null
  startRecord: (id: string) => void
  cancelRecord: () => void
  clearBinding: (id: string) => void
  resetToDefault: (id: string) => void
}

function getRecordGestures(action: Pick<ShortcutAction, 'activation'>): ShortcutGestureType[] {
  return action.activation === 'hold'
    ? ['hold']
    : ['press', 'doublePress']
}

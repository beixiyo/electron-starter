import type { ShortcutRecordSession } from '@/shortcuts/shortcutConfigAdapter'
import { bindShortcutRecordEvents } from '@/shortcuts/shortcutConfigAdapter'
import type { ShortcutGestureType, ShortcutRecordActive, ShortcutRecordDetection, ShortcutRecordDetectionPhase, ShortcutRecordEngine } from '@shared/shortcuts'
import { canShortcutChordDoublePress, createShortcutRecordEngine } from '@shared/shortcuts'
import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'

/**
 * 一轮录制的状态机宿主
 *
 * 它只负责把输入事件转换成录制结果；当前绑定、冲突和系统保留键由上层校验
 */
export function useRecordBinding(options: UseRecordBindingOptions = {}) {
  const { onActiveChange } = options
  const [phase, setPhase] = useState<ShortcutRecordDetectionPhase>('idle')
  const [detected, setDetected] = useState<ShortcutRecordDetection | null>(null)
  const [active, setActive] = useState<ShortcutRecordActive | null>(null)
  const engineRef = useRef<ShortcutRecordEngine | null>(null)
  const nativeCaptureRef = useRef(false)

  const handlePhaseChange = useLatestCallback(setPhase)
  const handleDetectedChange = useLatestCallback(setDetected)
  const handleActiveChange = useLatestCallback((next: ShortcutRecordActive | null) => {
    setActive(next)
    onActiveChange?.(next)
  })

  if (!engineRef.current) {
    engineRef.current = createShortcutRecordEngine({
      onPhaseChange: handlePhaseChange,
      onDetectedChange: handleDetectedChange,
      onActiveChange: handleActiveChange,
      canDoublePress: canShortcutChordDoublePress,
    })
  }

  const engine = engineRef.current

  const start = useLatestCallback((supportedGestures: readonly ShortcutGestureType[], session: ShortcutRecordSession) => {
    nativeCaptureRef.current = session.nativeCapture
    engine.start(supportedGestures)
  })

  const cancel = useLatestCallback(() => {
    engine.cancel()
  })

  /** 校验失败后清掉当前结果并继续等待下一轮输入。 */
  const retry = useLatestCallback(() => {
    engine.reset()
  })

  const isActive = phase !== 'idle'

  useEffect(() => {
    if (!isActive) return

    return bindShortcutRecordEvents({
      emit: engine.handle,
      onReset: engine.reset,
      nativeCapture: nativeCaptureRef.current,
    })
  }, [engine, isActive])

  useEffect(() => {
    return () => engine.dispose()
  }, [engine])

  return {
    detected,
    /** 判定完成前正按住或等待第二次按键的组合。 */
    active,
    isRecording: isActive,
    start,
    cancel,
    retry,
  }
}

export type UseRecordBindingOptions = {
  /** 新一轮输入开始时通知上层清掉旧的校验失败。 */
  onActiveChange?: (active: ShortcutRecordActive | null) => void
}

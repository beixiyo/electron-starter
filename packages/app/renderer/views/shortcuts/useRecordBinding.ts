import type {
  ShortcutGestureBinding,
  ShortcutRecordDetectionPhase,
  ShortcutRecordEngine,
} from '@shared/shortcuts'
import type { GestureType } from './types'
import { createShortcutRecordEngine } from '@shared/shortcuts'
import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'
import { bindShortcutRecordEvents } from '@/shortcuts/shortcutConfigAdapter'

export function useRecordBinding() {
  const [phase, setPhase] = useState<ShortcutRecordDetectionPhase>('idle')
  const [detected, setDetected] = useState<ShortcutGestureBinding | null>(null)
  const engineRef = useRef<ShortcutRecordEngine | null>(null)

  const handlePhaseChange = useLatestCallback(setPhase)
  const handleDetectedChange = useLatestCallback(setDetected)

  if (!engineRef.current) {
    engineRef.current = createShortcutRecordEngine({
      onPhaseChange: handlePhaseChange,
      onDetectedChange: handleDetectedChange,
    })
  }

  const engine = engineRef.current

  const start = useLatestCallback((supportedGestures: GestureType[]) => {
    engine.start(supportedGestures)
  })

  const cancel = useLatestCallback(() => {
    engine.cancel()
  })

  const isActive = phase !== 'idle'

  /** 桌面端由 IPC 转发 native/uIOhook 事件；Web 端由 adapter fallback 到 DOM KeyboardEvent */
  useEffect(() => {
    if (!isActive)
      return

    return bindShortcutRecordEvents(engine.handle)
  }, [engine, isActive])

  useEffect(() => {
    return () => engine.dispose()
  }, [engine])

  /** 录制期间屏蔽浏览器滚动默认行为（Space / 方向键等） */
  useEffect(() => {
    if (!isActive)
      return

    const SCROLL_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'])
    const prevent = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key))
        e.preventDefault()
    }
    window.addEventListener('keydown', prevent, true)
    return () => window.removeEventListener('keydown', prevent, true)
  }, [isActive])

  return {
    phase,
    detected,
    isRecording: phase === 'waiting' || phase === 'deciding' || phase === 'wait_double',
    isDetected: phase === 'detected',
    isUnsupported: phase === 'unsupported',
    start,
    cancel,
  }
}

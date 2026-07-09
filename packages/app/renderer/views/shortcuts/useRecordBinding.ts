import type { ShortcutChord, ShortcutRecordEvent } from '@ipc/services/shortcut-config/contract'
import type { GestureType, ShortcutBinding } from './types'
import { shortcutChordsEqual } from '@ipc/services/shortcut-config/contract'
import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'

const DOUBLE_PRESS_INTERVAL_MS = 300
const HOLD_MIN_DURATION_MS = 300
const UNSUPPORTED_RESET_MS = 1500

type RecordPhase = 'idle' | 'waiting' | 'deciding' | 'wait_double' | 'detected' | 'unsupported'

export function useRecordBinding() {
  const [phase, setPhase] = useState<RecordPhase>('idle')
  const [detected, setDetected] = useState<ShortcutBinding | null>(null)

  const phaseRef = useRef<RecordPhase>('idle')
  const supportedRef = useRef<GestureType[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeChordRef = useRef<ShortcutChord | null>(null)
  const activeStartedAtRef = useRef(0)
  const pendingChordRef = useRef<ShortcutChord | null>(null)
  const holdDetectedRef = useRef(false)

  const syncPhase = (nextPhase: RecordPhase) => {
    phaseRef.current = nextPhase
    setPhase(nextPhase)
  }

  const clearTimer = () => {
    if (!timerRef.current)
      return

    clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const clearActiveChord = () => {
    activeChordRef.current = null
    activeStartedAtRef.current = 0
    holdDetectedRef.current = false
  }

  const clearRecordState = () => {
    clearTimer()
    clearActiveChord()
    pendingChordRef.current = null
  }

  const hasGesture = (gesture: GestureType) => supportedRef.current.includes(gesture)

  const canAcceptInput = () => {
    const phase = phaseRef.current
    return phase === 'waiting'
      || phase === 'deciding'
      || phase === 'wait_double'
  }

  const detect = useLatestCallback((binding: ShortcutBinding) => {
    clearRecordState()
    if (supportedRef.current.includes(binding.gesture)) {
      setDetected(binding)
      syncPhase('detected')
      return
    }

    setDetected(binding)
    syncPhase('unsupported')
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (phaseRef.current === 'unsupported') {
        setDetected(null)
        syncPhase('waiting')
      }
    }, UNSUPPORTED_RESET_MS)
  })

  const finishShortPress = useLatestCallback((chord: ShortcutChord) => {
    const canPress = hasGesture('press')
    const canDoublePress = hasGesture('doublePress')

    if (canDoublePress) {
      clearTimer()
      pendingChordRef.current = chord
      syncPhase('wait_double')
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        pendingChordRef.current = null

        if (canPress) {
          detect({ gesture: 'press', chord })
        }
        else if (phaseRef.current === 'wait_double') {
          syncPhase('waiting')
        }
      }, DOUBLE_PRESS_INTERVAL_MS)
      return
    }

    detect({ gesture: 'press', chord })
  })

  const handleShortcutDown = useLatestCallback((chord: ShortcutChord, timestamp = Date.now()) => {
    if (!canAcceptInput())
      return
    if (activeChordRef.current)
      return

    const pendingChord = pendingChordRef.current
    if (hasGesture('doublePress') && pendingChord && shortcutChordsEqual(pendingChord, chord)) {
      detect({ gesture: 'doublePress', chord, intervalMs: DOUBLE_PRESS_INTERVAL_MS })
      return
    }

    clearTimer()
    pendingChordRef.current = null
    activeChordRef.current = chord
    activeStartedAtRef.current = timestamp
    holdDetectedRef.current = false
    syncPhase('deciding')

    if (!hasGesture('hold'))
      return

    timerRef.current = setTimeout(() => {
      timerRef.current = null
      const activeChord = activeChordRef.current
      if (!activeChord || !shortcutChordsEqual(activeChord, chord))
        return

      holdDetectedRef.current = true
      detect({ gesture: 'hold', chord, minDurationMs: HOLD_MIN_DURATION_MS })
    }, HOLD_MIN_DURATION_MS)
  })

  const handleShortcutUp = useLatestCallback((chord: ShortcutChord, timestamp = Date.now()) => {
    const activeChord = activeChordRef.current
    if (!activeChord || !shortcutChordsEqual(activeChord, chord))
      return

    const startedAt = activeStartedAtRef.current
    const holdDetected = holdDetectedRef.current
    clearTimer()
    clearActiveChord()

    if (holdDetected)
      return

    const elapsed = Math.max(timestamp - startedAt, 0)
    if (hasGesture('hold') && elapsed >= HOLD_MIN_DURATION_MS) {
      detect({ gesture: 'hold', chord, minDurationMs: HOLD_MIN_DURATION_MS })
      return
    }

    finishShortPress(chord)
  })

  const handleInstantPress = useLatestCallback((chord: ShortcutChord) => {
    if (!canAcceptInput())
      return

    const pendingChord = pendingChordRef.current
    if (hasGesture('doublePress') && pendingChord && shortcutChordsEqual(pendingChord, chord)) {
      detect({ gesture: 'doublePress', chord, intervalMs: DOUBLE_PRESS_INTERVAL_MS })
      return
    }

    clearActiveChord()
    finishShortPress(chord)
  })

  const handleRecordEvent = useLatestCallback((event: ShortcutRecordEvent) => {
    if (event.phase === 'down') {
      handleShortcutDown(event.chord, event.timestamp)
      return
    }

    handleShortcutUp(event.chord, event.timestamp)
  })

  const start = useLatestCallback((supportedGestures: GestureType[]) => {
    clearRecordState()
    supportedRef.current = supportedGestures
    setDetected(null)
    syncPhase('waiting')
  })

  const cancel = useLatestCallback(() => {
    clearRecordState()
    setDetected(null)
    syncPhase('idle')
  })

  const isActive = phase !== 'idle'

  // Fn 手势 + 主进程键盘录制事件
  useEffect(() => {
    if (!isActive)
      return

    const ipc = window.$ipc
    if (!ipc)
      return

    const unsubDown = ipc.fn.on('down', () => {
      handleShortcutDown({ source: 'fn', key: 'Fn' })
    })

    const unsubUp = ipc.fn.on('up', () => {
      handleShortcutUp({ source: 'fn', key: 'Fn' })
    })

    const unsubCombo = ipc.fn.on('combo', ({ key, modifiers }) => {
      handleInstantPress({ source: 'fn', key, modifiers })
    })

    const unsubRecord = ipc.shortcutConfig.on('record', handleRecordEvent)

    return () => {
      unsubDown()
      unsubUp()
      unsubCombo()
      unsubRecord()
    }
  }, [handleInstantPress, handleRecordEvent, handleShortcutDown, handleShortcutUp, isActive])

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

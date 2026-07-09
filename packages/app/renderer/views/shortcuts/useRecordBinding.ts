import type { ShortcutChord } from '@ipc/services/shortcut-config/contract'
import type { GestureType, ShortcutBinding } from './types'
import { shortcutChordsEqual } from '@ipc/services/shortcut-config/contract'
import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'

const DECIDING_MS = 300
const UNSUPPORTED_RESET_MS = 1500

type RecordPhase = 'idle' | 'waiting' | 'deciding' | 'wait_double' | 'detected' | 'unsupported'

export function useRecordBinding() {
  const [phase, setPhase] = useState<RecordPhase>('idle')
  const [detected, setDetected] = useState<ShortcutBinding | null>(null)

  const phaseRef = useRef<RecordPhase>('idle')
  const supportedRef = useRef<GestureType[]>([])
  const downTimeRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingChordRef = useRef<ShortcutChord | null>(null)

  const syncPhase = (p: RecordPhase) => {
    phaseRef.current = p
    setPhase(p)
  }

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const detect = useLatestCallback((binding: ShortcutBinding) => {
    clearTimer()
    pendingChordRef.current = null
    if (supportedRef.current.includes(binding.gesture)) {
      setDetected(binding)
      syncPhase('detected')
    }
    else {
      setDetected(binding)
      syncPhase('unsupported')
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (phaseRef.current === 'unsupported') {
          setDetected(null)
          syncPhase('waiting')
        }
      }, UNSUPPORTED_RESET_MS)
    }
  })

  const start = useLatestCallback((supportedGestures: GestureType[]) => {
    clearTimer()
    pendingChordRef.current = null
    supportedRef.current = supportedGestures
    setDetected(null)
    syncPhase('waiting')
  })

  const cancel = useLatestCallback(() => {
    clearTimer()
    pendingChordRef.current = null
    setDetected(null)
    syncPhase('idle')
  })

  const detectChordPress = useLatestCallback((chord: ShortcutChord) => {
    const supported = supportedRef.current
    const canPress = supported.includes('press')
    const canDoublePress = supported.includes('doublePress')
    const pendingChord = pendingChordRef.current

    if (canDoublePress && pendingChord && shortcutChordsEqual(pendingChord, chord)) {
      detect({ gesture: 'doublePress', chord, intervalMs: DECIDING_MS })
      return
    }

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
      }, DECIDING_MS)
      return
    }

    detect({ gesture: 'press', chord })
  })

  const isActive = phase !== 'idle'

  // Fn 手势 + 主进程 hotkey 检测
  useEffect(() => {
    if (!isActive)
      return

    const ipc = window.$ipc
    if (!ipc)
      return

    const unsubDown = ipc.fn.on('down', () => {
      const cur = phaseRef.current
      if (cur === 'waiting' || cur === 'deciding') {
        clearTimer()
        pendingChordRef.current = null
        downTimeRef.current = Date.now()
        syncPhase('deciding')
      }
      else if (cur === 'wait_double') {
        const pendingChord = pendingChordRef.current
        if (pendingChord && (pendingChord.source !== 'fn' || pendingChord.key !== 'Fn'))
          return
        detect({ gesture: 'doublePress', chord: { source: 'fn', key: 'Fn' }, intervalMs: DECIDING_MS })
      }
    })

    const unsubUp = ipc.fn.on('up', () => {
      if (phaseRef.current !== 'deciding')
        return
      clearTimer()
      const elapsed = Date.now() - downTimeRef.current
      if (elapsed >= DECIDING_MS) {
        detect({ gesture: 'hold', chord: { source: 'fn', key: 'Fn' }, minDurationMs: DECIDING_MS })
      }
      else {
        const remaining = Math.max(DECIDING_MS - elapsed, 50)
        syncPhase('wait_double')
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          if (phaseRef.current === 'wait_double')
            syncPhase('waiting')
        }, remaining)
      }
    })

    const unsubCombo = ipc.fn.on('combo', ({ key, modifiers }) => {
      const cur = phaseRef.current
      if (cur === 'deciding' || cur === 'waiting' || cur === 'wait_double')
        detectChordPress({ source: 'fn', key, modifiers })
    })

    /** 主进程 uIOhook 检测到修饰键组合（替代原浏览器 keydown 方案） */
    const unsubHotkey = ipc.shortcutConfig.on('hotkey', (chord) => {
      const cur = phaseRef.current
      if (cur === 'waiting' || cur === 'deciding' || cur === 'wait_double')
        detectChordPress(chord)
    })

    return () => {
      unsubDown()
      unsubUp()
      unsubCombo()
      unsubHotkey()
    }
  }, [isActive])

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

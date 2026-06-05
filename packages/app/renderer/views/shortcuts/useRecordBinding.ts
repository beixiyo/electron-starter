import type { GestureType, ShortcutBinding } from './types'
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
    if (supportedRef.current.includes(binding.type)) {
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
    supportedRef.current = supportedGestures
    setDetected(null)
    syncPhase('waiting')
  })

  const cancel = useLatestCallback(() => {
    clearTimer()
    setDetected(null)
    syncPhase('idle')
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
        downTimeRef.current = Date.now()
        syncPhase('deciding')
      }
      else if (cur === 'wait_double') {
        detect({ type: 'doublePress' })
      }
    })

    const unsubUp = ipc.fn.on('up', () => {
      if (phaseRef.current !== 'deciding')
        return
      clearTimer()
      const elapsed = Date.now() - downTimeRef.current
      if (elapsed >= DECIDING_MS) {
        detect({ type: 'hold' })
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
      if (cur === 'deciding' || cur === 'waiting')
        detect({ type: 'combo', key, modifiers })
    })

    /** 主进程 uIOhook 检测到修饰键组合（替代原浏览器 keydown 方案） */
    const unsubHotkey = ipc.shortcutConfig.on('hotkey', ({ key, modifiers }) => {
      const cur = phaseRef.current
      if (cur === 'waiting' || cur === 'deciding')
        detect({ type: 'hotkey', key, modifiers })
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

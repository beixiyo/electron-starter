import type { GestureType, ShortcutBinding } from './types'
import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'

const DECIDING_MS = 300
const UNSUPPORTED_RESET_MS = 1500

const MODIFIER_KEYS = new Set([
  'Meta',
  'Control',
  'Alt',
  'Shift',
  'CapsLock',
  'Dead',
  'Process',
  'AltGraph',
])

type RecordPhase = 'idle' | 'waiting' | 'deciding' | 'wait_double' | 'detected' | 'unsupported'

function normalizeHotkeyKey(e: KeyboardEvent): string {
  if (e.key === ' ')
    return 'Space'
  if (e.key.length === 1)
    return e.key.toUpperCase()
  return e.key
}

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

  useEffect(() => {
    if (!isActive)
      return

    const ipc = window.$ipc?.fn
    if (!ipc)
      return

    const unsubDown = ipc.on('down', () => {
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

    const unsubUp = ipc.on('up', () => {
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

    const unsubCombo = ipc.on('combo', ({ key, modifiers }) => {
      const cur = phaseRef.current
      if (cur === 'deciding' || cur === 'waiting')
        detect({ type: 'combo', key, modifiers })
    })

    const onKeyDown = (e: KeyboardEvent) => {
      if (phaseRef.current === 'idle')
        return
      const hasMainMod = e.metaKey || e.ctrlKey || e.altKey
      if (!hasMainMod || MODIFIER_KEYS.has(e.key))
        return

      e.preventDefault()
      e.stopPropagation()

      const modifiers: Array<'Meta' | 'Control' | 'Alt' | 'Shift'> = []
      if (e.metaKey)
        modifiers.push('Meta')
      if (e.ctrlKey)
        modifiers.push('Control')
      if (e.altKey)
        modifiers.push('Alt')
      if (e.shiftKey)
        modifiers.push('Shift')

      detect({ type: 'hotkey', modifiers, key: normalizeHotkeyKey(e) })
    }

    window.addEventListener('keydown', onKeyDown, true)

    return () => {
      unsubDown()
      unsubUp()
      unsubCombo()
      window.removeEventListener('keydown', onKeyDown, true)
    }
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

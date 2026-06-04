import type { ShortcutBinding } from './types'
import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'

const DECIDING_MS = 300

type RecordPhase = 'idle' | 'waiting' | 'deciding' | 'wait_double' | 'detected'

export function useRecordBinding() {
  const [phase, setPhase] = useState<RecordPhase>('idle')
  const [detected, setDetected] = useState<ShortcutBinding | null>(null)

  const phaseRef = useRef<RecordPhase>('idle')
  const downTimeRef = useRef(0)
  const decidingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const waitDoubleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const syncPhase = (p: RecordPhase) => {
    phaseRef.current = p
    setPhase(p)
  }

  const clearTimers = () => {
    if (decidingTimerRef.current) {
      clearTimeout(decidingTimerRef.current)
      decidingTimerRef.current = null
    }
    if (waitDoubleTimerRef.current) {
      clearTimeout(waitDoubleTimerRef.current)
      waitDoubleTimerRef.current = null
    }
  }

  const detect = useLatestCallback((binding: ShortcutBinding) => {
    clearTimers()
    setDetected(binding)
    syncPhase('detected')
  })

  const start = useLatestCallback(() => {
    clearTimers()
    setDetected(null)
    syncPhase('waiting')
  })

  const cancel = useLatestCallback(() => {
    clearTimers()
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
        clearTimers()
        downTimeRef.current = Date.now()
        syncPhase('deciding')

        decidingTimerRef.current = setTimeout(() => {
          decidingTimerRef.current = null
          // fn still held past DECIDING_MS — remains in deciding until fn.up
        }, DECIDING_MS)
      }
      else if (cur === 'wait_double') {
        detect({ type: 'doublePress' })
      }
    })

    const unsubUp = ipc.on('up', () => {
      const cur = phaseRef.current

      if (cur === 'deciding') {
        clearTimers()
        const elapsed = Date.now() - downTimeRef.current

        if (elapsed >= DECIDING_MS) {
          detect({ type: 'hold' })
        }
        else {
          const remaining = Math.max(DECIDING_MS - elapsed, 50)
          syncPhase('wait_double')
          waitDoubleTimerRef.current = setTimeout(() => {
            waitDoubleTimerRef.current = null
            if (phaseRef.current === 'wait_double') {
              syncPhase('waiting')
            }
          }, remaining)
        }
      }
    })

    const unsubCombo = ipc.on('combo', ({ key }) => {
      const cur = phaseRef.current
      if (cur === 'deciding' || cur === 'waiting') {
        detect({ type: 'combo', key })
      }
    })

    return () => {
      unsubDown()
      unsubUp()
      unsubCombo()
    }
  }, [isActive])

  return {
    phase,
    detected,
    isRecording: phase === 'waiting' || phase === 'deciding' || phase === 'wait_double',
    isDetected: phase === 'detected',
    start,
    cancel,
  }
}

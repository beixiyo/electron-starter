/** 取消后的短暂撤销窗口；资源留在内存中，超时或关闭时立即释放。 */
import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'

export const VOICE_UNDO_WINDOW_MS = 5000

export function useVoiceUndoWindow<T = Blob>(options: UseVoiceUndoWindowOptions = {}): VoiceUndoWindow<T> {
  const { windowMs = VOICE_UNDO_WINDOW_MS, onExpire } = options
  const valueRef = useRef<T | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generationRef = useRef(0)
  const [isPending, setIsPending] = useState(false)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)

  const clearTimer = useLatestCallback(() => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  })

  const close = useLatestCallback(() => {
    generationRef.current += 1
    clearTimer()
    valueRef.current = null
    setIsPending(false)
    setExpiresAt(null)
  })

  const open = useLatestCallback((value: T) => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    clearTimer()
    valueRef.current = value
    setIsPending(true)
    setExpiresAt(Date.now() + windowMs)
    timerRef.current = setTimeout(() => {
      if (generationRef.current !== generation) return
      timerRef.current = null
      valueRef.current = null
      setIsPending(false)
      setExpiresAt(null)
      onExpire?.()
    }, windowMs)
  })

  const consume = useLatestCallback(() => {
    const value = valueRef.current
    close()
    return value
  })

  useEffect(() => close, [close])

  return { isPending, expiresAt, open, consume, close }
}

export type UseVoiceUndoWindowOptions = {
  /** 窗口时长，默认 5000ms。 */
  windowMs?: number
  /** 到期后调用；手动 consume/close 不调用。 */
  onExpire?: () => void
}

export type VoiceUndoWindow<T = Blob> = {
  isPending: boolean
  expiresAt: number | null
  open: (value: T) => void
  consume: () => T | null
  close: () => void
}

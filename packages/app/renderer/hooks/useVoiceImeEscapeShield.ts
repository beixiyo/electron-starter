/** 语音会话期间在 renderer 捕获阶段消费 Escape，避免同一按键穿透到下层浮层。 */
import { initVoiceImeStore, voiceImeStore } from '@/store/voiceImeStore'
import { useKeyboardLayer } from 'hooks'
import { useEffect, useRef, useSyncExternalStore } from 'react'

export const VOICE_IME_ESCAPE_SHIELD_PRIORITY = Number.MAX_SAFE_INTEGER
export const VOICE_IME_LATE_ESCAPE_WINDOW_MS = 2000

export function useVoiceImeEscapeShield(): void {
  const snapshot = useSyncExternalStore(
    voiceImeStore.subscribe,
    voiceImeStore.getSnapshot,
    voiceImeStore.getSnapshot,
  )
  const isActive = snapshot.phase !== 'idle'
  const idleAtRef = useRef(-Infinity)
  const wasActiveRef = useRef(isActive)

  useEffect(() => initVoiceImeStore(), [])

  useEffect(() => {
    if (wasActiveRef.current && !isActive) idleAtRef.current = performance.now()
    wasActiveRef.current = isActive
  }, [isActive])

  useEffect(() => {
    const swallowLateEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || voiceImeStore.isActive) return
      const idleAt = idleAtRef.current
      if (event.timeStamp > idleAt || performance.now() - idleAt > VOICE_IME_LATE_ESCAPE_WINDOW_MS) return
      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener('keydown', swallowLateEscape, true)
    return () => window.removeEventListener('keydown', swallowLateEscape, true)
  }, [])

  useKeyboardLayer({
    active: isActive,
    keys: ['Escape'],
    priority: VOICE_IME_ESCAPE_SHIELD_PRIORITY,
    consume: true,
    allowRepeat: true,
  })
}

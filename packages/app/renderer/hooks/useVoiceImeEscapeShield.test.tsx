// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyVoiceImeActiveState } from '@/store/voiceImeStore'
import { useVoiceImeEscapeShield } from './useVoiceImeEscapeShield'

const idle = () => ({
  phase: 'idle' as const,
  recordingStartedAt: null,
  surface: null,
  sessionId: null,
})

const recording = (sessionId: string) => ({
  phase: 'recording' as const,
  recordingStartedAt: 100,
  surface: 'floating' as const,
  sessionId,
})

describe('useVoiceImeEscapeShield', () => {
  beforeEach(() => {
    applyVoiceImeActiveState(idle())
  })

  afterEach(() => {
    cleanup()
    applyVoiceImeActiveState(idle())
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('活动会话消费 Escape，避免事件到达下层窗口监听器', () => {
    const lowerLayer = vi.fn()
    window.addEventListener('keydown', lowerLayer)
    renderHook(() => useVoiceImeEscapeShield())

    act(() => applyVoiceImeActiveState(recording('session-1')))

    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
    document.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(lowerLayer).not.toHaveBeenCalled()
    window.removeEventListener('keydown', lowerLayer)
  })

  it('会话刚结束时仍消费迟到的 Escape，之后恢复正常传播', () => {
    vi.useFakeTimers()
    const lowerLayer = vi.fn()
    window.addEventListener('keydown', lowerLayer)
    renderHook(() => useVoiceImeEscapeShield())

    act(() => applyVoiceImeActiveState(recording('session-1')))
    act(() => applyVoiceImeActiveState(idle()))

    const lateEvent = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
    Object.defineProperty(lateEvent, 'timeStamp', { value: performance.now() - 1 })
    document.dispatchEvent(lateEvent)
    expect(lateEvent.defaultPrevented).toBe(true)
    expect(lowerLayer).not.toHaveBeenCalled()

    vi.advanceTimersByTime(VOICE_IME_LATE_ESCAPE_WINDOW_MS + 1)
    const normalEvent = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
    document.dispatchEvent(normalEvent)
    expect(normalEvent.defaultPrevented).toBe(false)
    expect(lowerLayer).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', lowerLayer)
  })
})

const VOICE_IME_LATE_ESCAPE_WINDOW_MS = 2000

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/env', () => ({ isElectron: () => true }))

const { applyVoiceImeActiveState, initVoiceImeStore, onVoiceImeRoundStart, voiceImeStore } = await import('./voiceImeStore')

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

describe('voiceImeStore', () => {
  beforeEach(() => {
    applyVoiceImeActiveState(idle())
  })

  it('不会让迟到的初始快照覆盖已收到的新 session 事件', async () => {
    let resolveInitial!: (state: ReturnType<typeof idle>) => void
    let emit!: (state: ReturnType<typeof recording>) => void
    const source = {
      getActiveState: () =>
        new Promise<ReturnType<typeof idle>>((resolve) => {
          resolveInitial = resolve
        }),
      subscribe: (listener: (state: ReturnType<typeof recording>) => void) => {
        emit = listener
        return () => {}
      },
    }
    const cleanup = initVoiceImeStore(source)

    emit(recording('new-session'))
    resolveInitial(idle())
    await Promise.resolve()

    expect(voiceImeStore.activeId).toBe('new-session')
    cleanup()
  })

  it('多个宿主共享一条 native 订阅，最后一个清理者才注销', async () => {
    const unsubscribe = vi.fn()
    const subscribe = vi.fn(() => unsubscribe)
    const source = {
      getActiveState: async () => idle(),
      subscribe,
    }
    const first = initVoiceImeStore(source)
    const second = initVoiceImeStore(source)
    await Promise.resolve()

    expect(subscribe).toHaveBeenCalledOnce()
    first()
    expect(unsubscribe).not.toHaveBeenCalled()
    second()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('recording 相位不变但 sessionId 改变时仍通知新一轮', () => {
    const onRoundStart = vi.fn()
    const cleanup = onVoiceImeRoundStart(onRoundStart)

    applyVoiceImeActiveState(recording('first'))
    applyVoiceImeActiveState(recording('second'))

    expect(onRoundStart).toHaveBeenCalledTimes(2)
    cleanup()
  })
})

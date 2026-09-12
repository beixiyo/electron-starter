/** 会话 Escape 监听器的生命周期与过期会话行为测试 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  registered: null as null | {
    isActive: () => boolean
    onEscape: () => void
  },
  register: vi.fn((consumer: {
    isActive: () => boolean
    onEscape: () => void
  }) => {
    harness.registered = consumer
    return harness.unregister
  }),
  unregister: vi.fn(),
  currentSessionId: null as string | null,
  isActive: false,
  escapeLog: vi.fn(),
}))

vi.mock('./global-escape', () => ({
  GLOBAL_ESCAPE_PRIORITY: { session: 100 },
  registerGlobalEscapeConsumer: harness.register,
}))

vi.mock('./logging', () => ({
  createMainDiagnosticLogger: () => ({
    info: harness.escapeLog,
  }),
}))

vi.mock('./voice-ime-state', () => ({
  voiceImeState: {
    get currentSessionId() {
      return harness.currentSessionId
    },
    get isActive() {
      return harness.isActive
    },
  },
}))

const {
  startVoiceImeEscapeWatcher,
  stopVoiceImeEscapeWatcher,
} = await import('./voice-ime-escape')

describe('会话 Escape 监听器', () => {
  beforeEach(() => {
    stopVoiceImeEscapeWatcher()
    harness.registered = null
    harness.register.mockClear()
    harness.unregister.mockClear()
    harness.currentSessionId = null
    harness.isActive = false
    harness.escapeLog.mockClear()
  })

  it('同一会话只登记一次，新会话会先注销旧监听器', () => {
    const onEscape = vi.fn()

    startVoiceImeEscapeWatcher('session-a', onEscape)
    startVoiceImeEscapeWatcher('session-a', onEscape)
    expect(harness.register).toHaveBeenCalledOnce()

    startVoiceImeEscapeWatcher('session-b', onEscape)
    expect(harness.unregister).toHaveBeenCalledOnce()
    expect(harness.register).toHaveBeenCalledTimes(2)
  })

  it('消费者在会话仍活跃且 id 匹配时才回调，旧会话不能取消新会话', () => {
    const onEscape = vi.fn()
    harness.currentSessionId = 'session-a'
    harness.isActive = true

    startVoiceImeEscapeWatcher('session-a', onEscape)
    expect(harness.registered?.isActive()).toBe(true)
    harness.registered?.onEscape()
    expect(onEscape).toHaveBeenCalledWith('session-a')

    harness.currentSessionId = 'session-b'
    harness.registered?.onEscape()
    expect(onEscape).toHaveBeenCalledOnce()
    expect(harness.registered?.isActive()).toBe(false)
  })

  it('停止监听器幂等且不会继续消费 Escape', () => {
    const onEscape = vi.fn()
    harness.currentSessionId = 'session-a'
    harness.isActive = true

    startVoiceImeEscapeWatcher('session-a', onEscape)
    const consumer = harness.registered
    stopVoiceImeEscapeWatcher()
    stopVoiceImeEscapeWatcher()

    expect(harness.unregister).toHaveBeenCalledOnce()
    harness.currentSessionId = null
    consumer?.onEscape()
    expect(onEscape).not.toHaveBeenCalled()
  })
})

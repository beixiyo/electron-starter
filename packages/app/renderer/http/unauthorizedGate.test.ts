/** 真实节流器与异步清理策略的集成，防止失败风暴重复登出或尾随补跑。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/logging', () => ({
  createRendererFeatureLogger: () => ({ error: vi.fn() }),
}))

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(10_000)
})

afterEach(() => vi.useRealTimers())

describe('unauthorized gate', () => {
  it('并发和陆续失败只执行一次，超过节流窗口也不会补跑', async () => {
    const { registerUnauthorizedHandler, runUnauthorizedHandler } = await import('./unauthorizedGate')
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const handler = vi.fn(() => pending)
    registerUnauthorizedHandler(handler)
    const first = runUnauthorizedHandler()
    await runUnauthorizedHandler()
    await vi.advanceTimersByTimeAsync(4000)
    await runUnauthorizedHandler()
    expect(handler).toHaveBeenCalledTimes(1)
    release()
    await first

    await runUnauthorizedHandler()
    expect(handler).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(100)
    await runUnauthorizedHandler()
    await vi.advanceTimersByTimeAsync(3001)
    expect(handler).toHaveBeenCalledTimes(2)
    await runUnauthorizedHandler()
    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('缺少处理器不占用节流窗口，旧清理函数不注销新处理器', async () => {
    const { registerUnauthorizedHandler, runUnauthorizedHandler } = await import('./unauthorizedGate')
    await runUnauthorizedHandler()
    const old = vi.fn()
    const current = vi.fn()
    const unregisterOld = registerUnauthorizedHandler(old)
    registerUnauthorizedHandler(current)
    unregisterOld()
    await runUnauthorizedHandler()
    expect(old).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledTimes(1)
  })
})

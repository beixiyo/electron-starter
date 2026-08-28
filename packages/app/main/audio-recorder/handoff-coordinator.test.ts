import { describe, expect, it, vi } from 'vitest'
import { RecorderHandoffCoordinator } from './handoff-coordinator'

describe('原生录音 stop handoff 协调器', () => {
  it('回收未确认旧 helper 退出时不得发布 stopped，沿 expected path 发布失败终态', async () => {
    const emitError = vi.fn()
    const emitStopped = vi.fn()
    const forceRestart = vi.fn(() => Promise.reject(new Error('exit unconfirmed')))
    const coordinator = new RecorderHandoffCoordinator({
      getHandoffGeneration: () => 11,
      finishHandoff: vi.fn(),
      forceRestart,
      emitError,
      logger: { error: vi.fn(), warn: vi.fn() },
    })

    coordinator.registerStopHandoff(11, '/tmp/recycle-timeout.m4a')
    coordinator.onHandoffStarted(11)
    coordinator.handleRecycleRequired(11)
    coordinator.emitTerminalAfterRequiredRecycle(11, '/tmp/recycle-timeout.m4a', emitStopped)
    await Promise.resolve()
    await Promise.resolve()

    expect(forceRestart).toHaveBeenCalledWith(11)
    expect(emitStopped).not.toHaveBeenCalled()
    expect(emitError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'handoff_timeout',
      path: '/tmp/recycle-timeout.m4a',
      terminal: true,
    }))
  })
})

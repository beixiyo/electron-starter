/**
 * uIOhook native 崩溃防线
 *
 * 消费者归零只摘业务 listener，不再调用不安全的 native stop；连续会话必须复用
 * App 进程级 Worker，避免 native abort 跨 Worker 终止整个 Electron 进程
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { acquireHook, releaseHook } from './uiohook-lifecycle'

const harness = vi.hoisted(() => ({
  createWorker: vi.fn(),
}))

vi.mock('../logging', () => ({
  createMainDiagnosticLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))
vi.mock('./runtime-sync', () => ({ requestShortcutRuntimeSync: vi.fn() }))
vi.mock('./uiohook-worker?nodeWorker', () => ({
  default: (...args: unknown[]) => harness.createWorker(...args),
}))

describe('uIOhook 生命周期', () => {
  it('连续会话复用 Worker，释放最后一个消费者时不停止 native hook', () => {
    const fakeWorker = Object.assign(new EventEmitter(), {
      postMessage: vi.fn(),
      terminate: vi.fn(() => Promise.resolve(0)),
      unref: vi.fn(),
    })
    harness.createWorker.mockReturnValue(fakeWorker)

    acquireHook()
    fakeWorker.emit('message', { type: 'ready' })
    releaseHook()

    acquireHook()
    releaseHook()

    expect(harness.createWorker).toHaveBeenCalledTimes(1)
    expect(fakeWorker.postMessage).not.toHaveBeenCalled()
  })
})

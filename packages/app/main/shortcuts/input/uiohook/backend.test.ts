/**
 * uIOhook 后端：native 崩溃防线与键码归一
 *
 * 守的是一次真机崩溃：macOS 未授予辅助功能时启动 hook 会让整个 Electron 进程 abort
 * （`uiohook_worker_start → uv_mutex_destroy → abort`）。这是 native 层的 `abort()`，
 * worker 的 try / catch、error / exit 事件与启动超时统统兜不住，所以唯一的防线就是
 * 「根本不去启动」。这条防线一旦被绕过，表现是 App 当场消失而不是任何可捕获的错误，
 * 手测只能靠先撤销系统授权——正是这类容易在回归中丢掉的前置条件
 * 同时守住会话释放边界：消费者归零只摘业务 listener，不再调用不安全的 native stop
 */

import type { KeyboardInput } from '@shared/shortcuts'
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  accessibility: 'granted' as 'granted' | 'denied',
  createWorker: vi.fn(),
}))

vi.mock('../../../permissions', () => ({
  getAppAccessibilityStatus: () => harness.accessibility,
}))
vi.mock('../../../logging', () => ({
  createMainDiagnosticLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))
vi.mock('../../runtime-sync', () => ({ requestShortcutRuntimeSync: vi.fn() }))
vi.mock('./worker?nodeWorker', () => ({
  default: (...args: unknown[]) => harness.createWorker(...args),
}))

const { uiohookKeyboardInputBackend: backend } = await import('./backend')
const { UiohookKey } = await import('./keycodes')

function createFakeWorker() {
  return Object.assign(new EventEmitter(), {
    postMessage: vi.fn(),
    terminate: vi.fn(() => Promise.resolve(0)),
    unref: vi.fn(),
  })
}

describe('uIOhook 授权门禁', () => {
  beforeEach(() => {
    harness.accessibility = 'granted'
  })

  it('macOS 未授予辅助功能时拒绝启动，且不创建 worker', () => {
    harness.accessibility = 'denied'

    expect(() => backend.acquire()).toThrow(/accessibility/i)
    expect(harness.createWorker).not.toHaveBeenCalled()
  })

  /** 运行时解析器据此把全局键盘绑定交给渲染进程兜底，判据必须与 `acquire` 一致 */
  it('未授权时后端判定为不可用，授权后立即恢复，不需要重启', () => {
    harness.accessibility = 'denied'
    expect(backend.isAvailable()).toBe(false)

    harness.accessibility = 'granted'
    expect(backend.isAvailable()).toBe(true)
  })

  /**
   * 回归真机现场：第一轮长按会话正常释放，第二轮释放停在 native stop 窗口后 App abort
   * 连续会话必须复用同一个 Worker，消费者归零也不能再向 native worker 发送 stop
   */
  it('连续会话复用 Worker，释放最后一个消费者时不停止 native hook', () => {
    const fakeWorker = createFakeWorker()
    harness.createWorker.mockReturnValue(fakeWorker)

    backend.acquire()
    fakeWorker.emit('message', { type: 'ready' })
    backend.release()

    backend.acquire()
    backend.release()

    expect(harness.createWorker).toHaveBeenCalledOnce()
    expect(fakeWorker.postMessage).not.toHaveBeenCalled()
  })
})

describe('uIOhook 键码归一', () => {
  it('修饰键补回物理侧别，未知键码丢弃，系统自动重复的 keydown 只上报一次', () => {
    /** Worker 驻留进程：沿用上一组用例已经启动的那一个，而不是再造一个挂不上的 */
    const fakeWorker = harness.createWorker.mock.results[0]?.value as ReturnType<typeof createFakeWorker>
    backend.acquire()

    const received: KeyboardInput[] = []
    const unsubscribe = backend.subscribe(input => received.push(input))

    const emit = (type: 'keydown' | 'keyup', keycode: number, altKey = false) => {
      fakeWorker.emit('message', {
        type,
        event: { keycode, altKey, ctrlKey: false, metaKey: false, shiftKey: false },
      })
    }

    emit('keydown', UiohookKey.AltRight, true)
    emit('keydown', UiohookKey.AltRight, true)
    emit('keydown', 0xFFFF, true)
    emit('keyup', UiohookKey.AltRight)
    emit('keydown', UiohookKey.Alt, true)
    unsubscribe()
    backend.release()

    expect(received.map(input => (
      input.phase === 'reset'
        ? 'reset'
        : `${input.phase}:${input.key}:${input.modifiers.join('+')}`
    ))).toEqual([
      'down:AltRight:Alt',
      'up:AltRight:',
      'down:AltLeft:Alt',
    ])
  })
})

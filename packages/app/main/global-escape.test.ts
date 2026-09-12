/** 全局 Escape 仲裁器的行为测试：去重、优先级、让位与后端生命周期 */

import type { KeyboardInput, KeyboardInputEvent } from '@shared/shortcuts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  focused: false,
  available: true,
  listener: null as null | ((input: KeyboardInput) => void),
  syncListeners: new Set<() => void>(),
  acquire: vi.fn(),
  release: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: () => (
      harness.focused
        ? {}
        : null
    ),
  },
}))

vi.mock('./logging', () => ({
  createMainDiagnosticLogger: () => ({
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('./shortcuts/input', () => ({
  keyboardInputBackend: {
    id: 'uiohook',
    isAvailable: () => harness.available,
    acquire: harness.acquire,
    release: harness.release,
    sync: vi.fn(),
    shutdown: vi.fn(),
    subscribe: (listener: (input: KeyboardInput) => void) => {
      harness.listener = listener
      return () => {
        harness.listener = null
      }
    },
  },
}))

vi.mock('./shortcuts/runtime-sync', () => ({
  onShortcutRuntimeSyncRequested: (listener: () => void) => {
    harness.syncListeners.add(listener)
    return () => {
      harness.syncListeners.delete(listener)
    }
  },
}))

const { GLOBAL_ESCAPE_PRIORITY, registerGlobalEscapeConsumer } = await import('./global-escape')

function send(input: KeyboardInput): void {
  harness.listener?.(input)
}

function pressEscape(overrides: Partial<KeyboardInputEvent> = {}): void {
  send({
    phase: 'down',
    key: 'Escape',
    modifiers: [],
    fn: false,
    timestamp: 1,
    ...overrides,
  })
}

function releaseEscape(): void {
  send({
    phase: 'up',
    key: 'Escape',
    modifiers: [],
    fn: false,
    timestamp: 2,
  })
}

describe('全局 Escape 仲裁器', () => {
  const cleanups: Array<() => void> = []

  beforeEach(() => {
    harness.focused = false
    harness.available = true
    for (const cleanup of cleanups.splice(0)) cleanup()
    harness.syncListeners.clear()
    harness.acquire.mockClear()
    harness.release.mockClear()
  })

  it('一次按住只交给一个活跃消费者，抬起后才接受下一次按下', () => {
    const first = vi.fn()
    const second = vi.fn()
    let firstActive = true

    cleanups.push(registerGlobalEscapeConsumer({
      id: 'first',
      priority: GLOBAL_ESCAPE_PRIORITY.session,
      isActive: () => firstActive,
      onEscape: () => {
        first()
        firstActive = false
      },
    }))
    cleanups.push(registerGlobalEscapeConsumer({
      id: 'second',
      priority: GLOBAL_ESCAPE_PRIORITY.surface,
      onEscape: second,
    }))

    pressEscape()
    pressEscape()
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()

    releaseEscape()
    pressEscape()
    expect(second).toHaveBeenCalledOnce()
  })

  it('自有窗口有焦点时跳过声明让位的消费者，但保留不让位的消费者', () => {
    const session = vi.fn()
    const surface = vi.fn()
    harness.focused = true

    cleanups.push(registerGlobalEscapeConsumer({
      id: 'session',
      priority: GLOBAL_ESCAPE_PRIORITY.session,
      onEscape: session,
    }))
    cleanups.push(registerGlobalEscapeConsumer({
      id: 'surface',
      priority: GLOBAL_ESCAPE_PRIORITY.surface,
      yieldToFocusedWindow: true,
      onEscape: surface,
    }))

    pressEscape()
    releaseEscape()

    expect(session).toHaveBeenCalledOnce()
    expect(surface).not.toHaveBeenCalled()

    cleanups.shift()?.()
    pressEscape()
    releaseEscape()
    expect(surface).not.toHaveBeenCalled()

    harness.focused = false
    pressEscape()
    expect(surface).toHaveBeenCalledOnce()
  })

  it('修饰键、Fn 和其它键都不触发消费者，且不会卡住下一次裸 Escape', () => {
    const onEscape = vi.fn()
    cleanups.push(registerGlobalEscapeConsumer({
      id: 'surface',
      priority: GLOBAL_ESCAPE_PRIORITY.surface,
      onEscape,
    }))

    send({ phase: 'down', key: 'Enter', modifiers: [], fn: false, timestamp: 1 })
    pressEscape({ modifiers: ['Meta'] })
    releaseEscape()
    pressEscape({ fn: true })
    releaseEscape()
    expect(onEscape).not.toHaveBeenCalled()

    pressEscape()
    expect(onEscape).toHaveBeenCalledOnce()
  })

  it('后端 reset 后重新接受按下', () => {
    const onEscape = vi.fn()
    cleanups.push(registerGlobalEscapeConsumer({
      id: 'surface',
      priority: GLOBAL_ESCAPE_PRIORITY.surface,
      onEscape,
    }))

    pressEscape()
    send({ phase: 'reset', timestamp: 3 })
    pressEscape()

    expect(onEscape).toHaveBeenCalledTimes(2)
  })

  it('首个消费者接入后端，最后一个消费者离开时释放后端', () => {
    const first = registerGlobalEscapeConsumer({ id: 'first', priority: 1, onEscape: vi.fn() })
    const second = registerGlobalEscapeConsumer({ id: 'second', priority: 2, onEscape: vi.fn() })

    expect(harness.acquire).toHaveBeenCalledOnce()
    expect(harness.listener).not.toBeNull()

    first()
    expect(harness.release).not.toHaveBeenCalled()

    second()
    second()
    expect(harness.release).toHaveBeenCalledOnce()
    expect(harness.listener).toBeNull()
  })

  it('后端不可用时不尝试 acquire，并可安全注销', () => {
    harness.available = false
    cleanups.push(registerGlobalEscapeConsumer({
      id: 'surface',
      priority: GLOBAL_ESCAPE_PRIORITY.surface,
      onEscape: vi.fn(),
    }))

    expect(harness.acquire).not.toHaveBeenCalled()
    expect(harness.release).not.toHaveBeenCalled()
  })

  it('权限恢复后由 runtime sync 重试并开始接收 Escape', () => {
    const onEscape = vi.fn()
    harness.available = false
    cleanups.push(registerGlobalEscapeConsumer({
      id: 'surface',
      priority: GLOBAL_ESCAPE_PRIORITY.surface,
      onEscape,
    }))

    expect(harness.acquire).not.toHaveBeenCalled()
    expect(harness.syncListeners.size).toBe(1)

    harness.available = true
    for (const sync of harness.syncListeners) sync()
    expect(harness.acquire).toHaveBeenCalledOnce()

    pressEscape()
    expect(onEscape).toHaveBeenCalledOnce()
  })
})

import type { FnNativeEvent } from '@ipc/services/fn/contract'
import type { ShortcutBindings } from '@shared/shortcuts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resumeShortcutRuntime, suspendShortcutRuntime } from '../suspension'
import { fnShortcutRuntimeBackend } from './runtime-backend'

const harness = vi.hoisted(() => ({
  listener: null as ((event: FnNativeEvent) => void) | null,
}))

vi.mock('./core', () => ({
  addFnRawEventListener: vi.fn((listener: (event: FnNativeEvent) => void) => {
    harness.listener = listener
    return () => {
      harness.listener = null
    }
  }),
  startFnKeyListener: vi.fn(),
  stopFnKeyListener: vi.fn(),
}))

vi.mock('../capabilities', () => ({
  canUseFnShortcutBackend: () => true,
}))

vi.mock('../providers', () => ({
  FN_SHORTCUT_RUNTIME_PROVIDER: {
    id: 'fn',
    source: 'fn',
    scopes: ['global', 'local'],
    platforms: ['darwin'],
    runtime: 'main',
  },
}))

describe('fn runtime backend', () => {
  afterEach(() => {
    fnShortcutRuntimeBackend.reset()
    resumeShortcutRuntime()
    vi.useRealTimers()
  })

  it('将 Fn 组合键完整相位交给 shared engine 判定 hold 并释放', async () => {
    vi.useFakeTimers()
    const emitted: Array<{ phase: string, gesture: string }> = []
    let canTrigger = true
    const bindings: ShortcutBindings = {
      voiceDictation: {
        scope: 'global',
        gesture: 'hold',
        chord: { source: 'fn', key: 'Space' },
      },
    }

    fnShortcutRuntimeBackend.apply(bindings, {
      getHandler: () => vi.fn(),
      canTrigger: () => canTrigger,
      emit: event => emitted.push({ phase: event.phase, gesture: event.gesture }),
    })

    harness.listener?.(input('down', 1))
    await vi.advanceTimersByTimeAsync(300)
    canTrigger = false
    harness.listener?.(input('up', 1))

    expect(emitted).toEqual([
      { phase: 'trigger', gesture: 'hold' },
      { phase: 'release', gesture: 'hold' },
    ])
  })

  it('native reset 在 backend 不可触发后仍释放 active hold', async () => {
    vi.useFakeTimers()
    const emitted: string[] = []
    let canTrigger = true
    const bindings: ShortcutBindings = {
      voiceDictation: {
        scope: 'local',
        gesture: 'hold',
        chord: { source: 'fn', key: 'Fn' },
      },
    }

    fnShortcutRuntimeBackend.apply(bindings, {
      getHandler: () => vi.fn(),
      canTrigger: () => canTrigger,
      emit: event => emitted.push(event.phase),
    })

    harness.listener?.({
      type: 'input',
      phase: 'down',
      sequence: 1,
      timestamp: 0,
      chord: { source: 'fn', key: 'Fn', modifiers: [] },
    })
    await vi.advanceTimersByTimeAsync(300)
    canTrigger = false
    harness.listener?.({ type: 'reset', timestamp: 300 })
    harness.listener?.({ type: 'reset', timestamp: 301 })

    expect(emitted).toEqual(['trigger', 'release'])
  })

  it('进入 suspension 时立即释放 active hold，且保留 native listener', async () => {
    vi.useFakeTimers()
    const emitted: string[] = []
    const bindings: ShortcutBindings = {
      voiceDictation: {
        scope: 'global',
        gesture: 'hold',
        chord: { source: 'fn', key: 'Space' },
      },
    }

    fnShortcutRuntimeBackend.apply(bindings, {
      getHandler: () => vi.fn(),
      canTrigger: () => true,
      emit: event => emitted.push(event.phase),
    })

    harness.listener?.(input('down', 1))
    await vi.advanceTimersByTimeAsync(300)
    suspendShortcutRuntime()

    expect(emitted).toEqual(['trigger', 'release'])
    expect(harness.listener).not.toBeNull()
  })
})

function input(phase: 'down' | 'up', timestamp: number): FnNativeEvent {
  return {
    type: 'input',
    phase,
    sequence: 1,
    timestamp,
    chord: { source: 'fn', key: 'Space', modifiers: [] },
  }
}

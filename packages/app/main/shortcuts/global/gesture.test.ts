import type { UiohookKeyboardEvent } from 'uiohook-napi'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { releaseHook } from '../uiohook-lifecycle'
import { resumeShortcutRuntime, suspendShortcutRuntime } from '../suspension'
import { registerKeyboardGestureShortcut, unregisterKeyboardGestureShortcuts } from './gesture'

const harness = vi.hoisted(() => ({
  keydown: null as ((event: UiohookKeyboardEvent) => void) | null,
  keyup: null as ((event: UiohookKeyboardEvent) => void) | null,
}))

vi.mock('../hold/resolve-key-group', () => ({
  resolveKeyGroup: (key: string) => ({
    Meta: [42, 44],
    MetaLeft: [42],
    MetaRight: [44],
    Control: [45, 46],
    ControlLeft: [45],
    ControlRight: [46],
    Alt: [41, 43],
    AltLeft: [41],
    AltRight: [43],
    Shift: [47, 48],
    ShiftLeft: [47],
    ShiftRight: [48],
    A: [30],
    V: [50],
  })[key] ?? [99],
}))
vi.mock('../uiohook-lifecycle', () => ({
  acquireHook: vi.fn(),
  releaseHook: vi.fn(),
  addUiohookKeyboardListeners: vi.fn((listeners: {
    keydown: (event: UiohookKeyboardEvent) => void
    keyup: (event: UiohookKeyboardEvent) => void
  }) => {
    harness.keydown = listeners.keydown
    harness.keyup = listeners.keyup

    return () => {
      harness.keydown = null
      harness.keyup = null
    }
  }),
}))
vi.mock('../../utils/logger', () => ({ logError: vi.fn() }))

describe('global keyboard gesture lifecycle', () => {
  beforeEach(() => {
    resumeShortcutRuntime()
    vi.clearAllMocks()
  })

  afterEach(() => {
    unregisterKeyboardGestureShortcuts()
    resumeShortcutRuntime()
    vi.useRealTimers()
  })

  it('重载期间释放已经触发的 hold', async () => {
    vi.useFakeTimers()
    const onRelease = vi.fn()
    registerKeyboardGestureShortcut({
      id: 'voiceDictation',
      binding: {
        scope: 'global',
        gesture: 'hold',
        chord: { source: 'keyboard', key: 'V', modifiers: [] },
      },
      onTrigger: vi.fn(),
      onRelease,
    })

    harness.keydown?.({
      keycode: 50,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    } as UiohookKeyboardEvent)
    await vi.advanceTimersByTimeAsync(300)
    unregisterKeyboardGestureShortcuts()

    expect(onRelease).toHaveBeenCalledOnce()
  })

  it('进入 suspension 时立即释放 active hold，且不停止 uiohook', async () => {
    vi.useFakeTimers()
    const onTrigger = vi.fn()
    const onRelease = vi.fn()
    registerKeyboardGestureShortcut({
      id: 'voiceDictation',
      binding: {
        scope: 'global',
        gesture: 'hold',
        chord: { source: 'keyboard', key: 'V', modifiers: [] },
      },
      onTrigger,
      onRelease,
    })

    harness.keydown?.(keyboardEvent({ keycode: 50 }))
    await vi.advanceTimersByTimeAsync(300)
    suspendShortcutRuntime()

    expect(onTrigger).toHaveBeenCalledWith('hold')
    expect(onRelease).toHaveBeenCalledWith('hold')
    expect(harness.keydown).not.toBeNull()
    expect(releaseHook).not.toHaveBeenCalled()
  })

  it('修饰键自身的状态不会被当成额外 modifier 拒绝', async () => {
    vi.useFakeTimers()
    const onTrigger = vi.fn()
    const onRelease = vi.fn()
    registerKeyboardGestureShortcut({
      id: 'voiceDictation',
      binding: {
        scope: 'global',
        gesture: 'hold',
        chord: { source: 'keyboard', key: 'MetaLeft', modifiers: [] },
      },
      onTrigger,
      onRelease,
    })

    harness.keydown?.(keyboardEvent({ metaKey: true }))
    await vi.advanceTimersByTimeAsync(300)
    harness.keyup?.(keyboardEvent({ metaKey: false }))

    expect(onTrigger).toHaveBeenCalledWith('hold')
    expect(onRelease).toHaveBeenCalledWith('hold')
  })

  it('右侧修饰键绑定不会被左侧同名修饰键触发', () => {
    const onTrigger = vi.fn()
    registerKeyboardGestureShortcut({
      id: 'voiceDictation',
      binding: {
        scope: 'global',
        gesture: 'press',
        chord: { source: 'keyboard', key: 'AltRight', modifiers: [] },
      },
      onTrigger,
    })

    harness.keydown?.(keyboardEvent({ keycode: 41, altKey: true }))
    harness.keyup?.(keyboardEvent({ keycode: 41, altKey: false }))
    expect(onTrigger).not.toHaveBeenCalled()

    harness.keydown?.(keyboardEvent({ keycode: 43, altKey: true }))
    harness.keyup?.(keyboardEvent({ keycode: 43, altKey: false }))
    expect(onTrigger).toHaveBeenCalledOnce()
    expect(onTrigger).toHaveBeenCalledWith('press')
  })

  it('多个修饰键组合要求除主键外的 modifier 精确匹配', () => {
    const onTrigger = vi.fn()
    registerKeyboardGestureShortcut({
      id: 'recording',
      binding: {
        scope: 'global',
        gesture: 'press',
        chord: { source: 'keyboard', key: 'MetaLeft', modifiers: ['AltRight'] },
      },
      onTrigger,
    })

    harness.keydown?.(keyboardEvent({ keycode: 42, metaKey: true }))
    harness.keydown?.(keyboardEvent({ keycode: 43, altKey: true, metaKey: true }))
    harness.keyup?.(keyboardEvent({ keycode: 43, altKey: false, metaKey: true }))

    expect(onTrigger).toHaveBeenCalledWith('press')
  })

  it('组合键开始时撤销单修饰键 hold 候选', async () => {
    vi.useFakeTimers()
    const onMeta = vi.fn()
    const onCombo = vi.fn()
    registerKeyboardGestureShortcut({
      id: 'meta',
      binding: {
        scope: 'global',
        gesture: 'hold',
        chord: { source: 'keyboard', key: 'MetaLeft', modifiers: [] },
      },
      onTrigger: onMeta,
    })
    registerKeyboardGestureShortcut({
      id: 'combo',
      binding: {
        scope: 'global',
        gesture: 'hold',
        chord: { source: 'keyboard', key: 'MetaLeft', modifiers: ['AltRight'] },
      },
      onTrigger: onCombo,
    })

    harness.keydown?.(keyboardEvent({ keycode: 42, metaKey: true }))
    harness.keydown?.(keyboardEvent({ keycode: 43, altKey: true, metaKey: true }))
    await vi.advanceTimersByTimeAsync(300)

    expect(onMeta).not.toHaveBeenCalled()
    expect(onCombo).toHaveBeenCalledWith('hold')
  })

  it('物理右 Option 绑定拒绝同时按住左 Option', () => {
    const onTrigger = vi.fn()
    registerKeyboardGestureShortcut({
      id: 'recording',
      binding: {
        scope: 'global',
        gesture: 'press',
        chord: { source: 'keyboard', key: 'A', modifiers: ['AltRight'] },
      },
      onTrigger,
    })

    harness.keydown?.(keyboardEvent({ keycode: 41, altKey: true }))
    harness.keydown?.(keyboardEvent({ keycode: 43, altKey: true }))
    harness.keydown?.(keyboardEvent({ keycode: 30, altKey: true }))
    harness.keyup?.(keyboardEvent({ keycode: 30, altKey: true }))

    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('hold 生效后新增同家族另一侧 modifier 会立即释放', async () => {
    vi.useFakeTimers()
    const onTrigger = vi.fn()
    const onRelease = vi.fn()
    registerKeyboardGestureShortcut({
      id: 'recording',
      binding: {
        scope: 'global',
        gesture: 'hold',
        chord: { source: 'keyboard', key: 'A', modifiers: ['AltRight'] },
      },
      onTrigger,
      onRelease,
    })

    harness.keydown?.(keyboardEvent({ keycode: 43, altKey: true }))
    harness.keydown?.(keyboardEvent({ keycode: 30, altKey: true }))
    await vi.advanceTimersByTimeAsync(300)
    harness.keydown?.(keyboardEvent({ keycode: 41, altKey: true }))

    expect(onTrigger).toHaveBeenCalledWith('hold')
    expect(onRelease).toHaveBeenCalledWith('hold')
  })

  it('普通主键仍按住时松开 modifier 会立即释放 hold', async () => {
    vi.useFakeTimers()
    const onRelease = vi.fn()
    registerKeyboardGestureShortcut({
      id: 'recording',
      binding: {
        scope: 'global',
        gesture: 'hold',
        chord: { source: 'keyboard', key: 'A', modifiers: ['AltRight'] },
      },
      onTrigger: vi.fn(),
      onRelease,
    })

    harness.keydown?.(keyboardEvent({ keycode: 43, altKey: true }))
    harness.keydown?.(keyboardEvent({ keycode: 30, altKey: true }))
    await vi.advanceTimersByTimeAsync(300)
    harness.keyup?.(keyboardEvent({ keycode: 43, altKey: false }))

    expect(onRelease).toHaveBeenCalledWith('hold')
  })

  it('逻辑 Alt modifier 仍匹配任一物理侧', () => {
    const onTrigger = vi.fn()
    registerKeyboardGestureShortcut({
      id: 'recording',
      binding: {
        scope: 'global',
        gesture: 'press',
        chord: { source: 'keyboard', key: 'A', modifiers: ['Alt'] },
      },
      onTrigger,
    })

    harness.keydown?.(keyboardEvent({ keycode: 41, altKey: true }))
    harness.keydown?.(keyboardEvent({ keycode: 30, altKey: true }))
    harness.keyup?.(keyboardEvent({ keycode: 30, altKey: true }))

    expect(onTrigger).toHaveBeenCalledWith('press')
  })
})

function keyboardEvent(overrides: Partial<UiohookKeyboardEvent>): UiohookKeyboardEvent {
  return {
    keycode: 42,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as UiohookKeyboardEvent
}

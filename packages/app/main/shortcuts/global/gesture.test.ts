import type { UiohookKeyboardEvent } from 'uiohook-napi'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerKeyboardGestureShortcut, unregisterKeyboardGestureShortcuts } from './gesture'

const harness = vi.hoisted(() => ({
  keydown: null as ((event: UiohookKeyboardEvent) => void) | null,
  keyup: null as ((event: UiohookKeyboardEvent) => void) | null,
}))

vi.mock('../hold/resolve-key-group', () => ({ resolveKeyGroup: () => [42] }))
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
  afterEach(() => {
    unregisterKeyboardGestureShortcuts()
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
      keycode: 42,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    } as UiohookKeyboardEvent)
    await vi.advanceTimersByTimeAsync(300)
    unregisterKeyboardGestureShortcuts()

    expect(onRelease).toHaveBeenCalledOnce()
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
        chord: { source: 'keyboard', key: 'Meta', modifiers: [] },
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

  it('多个修饰键组合要求除主键外的 modifier 精确匹配', () => {
    const onTrigger = vi.fn()
    registerKeyboardGestureShortcut({
      id: 'recording',
      binding: {
        scope: 'global',
        gesture: 'press',
        chord: { source: 'keyboard', key: 'Meta', modifiers: ['Alt'] },
      },
      onTrigger,
    })

    harness.keydown?.(keyboardEvent({ altKey: true, metaKey: true }))
    harness.keyup?.(keyboardEvent({ altKey: false, metaKey: true }))

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
        chord: { source: 'keyboard', key: 'Meta', modifiers: [] },
      },
      onTrigger: onMeta,
    })
    registerKeyboardGestureShortcut({
      id: 'combo',
      binding: {
        scope: 'global',
        gesture: 'hold',
        chord: { source: 'keyboard', key: 'Meta', modifiers: ['Alt'] },
      },
      onTrigger: onCombo,
    })

    harness.keydown?.(keyboardEvent({ metaKey: true }))
    harness.keydown?.(keyboardEvent({ altKey: true, metaKey: true }))
    await vi.advanceTimersByTimeAsync(300)

    expect(onMeta).not.toHaveBeenCalled()
    expect(onCombo).toHaveBeenCalledWith('hold')
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

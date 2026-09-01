/** 验证窗口内快捷键运行时的物理 modifier 精确匹配与释放生命周期 */
import { WEB_SHORTCUT_CAPABILITIES } from '@shared/shortcuts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserShortcutRuntime } from './useShortcutRuntime'

const harness = vi.hoisted(() => ({
  listeners: new Map<string, (event: KeyboardEvent) => void>(),
}))

vi.mock('./shortcutConfigAdapter', () => ({
  isShortcutRuntimePaused: () => false,
}))

describe('窗口内快捷键运行时', () => {
  beforeEach(() => {
    harness.listeners.clear()
    vi.stubGlobal('window', {
      addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
        harness.listeners.set(type, listener)
      },
      removeEventListener: (type: string) => {
        harness.listeners.delete(type)
      },
    })
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('hold 生效后新增同家族另一侧 modifier 会立即释放', async () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const runtime = createBrowserShortcutRuntime({
      bindings: {
        voiceDictation: {
          scope: 'local',
          gesture: 'hold',
          chord: { source: 'keyboard', key: 'A', modifiers: ['AltRight'] },
        },
      },
      capabilities: WEB_SHORTCUT_CAPABILITIES,
      canHandle: () => true,
      emit,
    })

    dispatch('keydown', keyboardEvent({ code: 'AltRight', key: 'Alt', altKey: true }))
    dispatch('keydown', keyboardEvent({ code: 'KeyA', key: 'a', altKey: true }))
    await vi.advanceTimersByTimeAsync(300)
    dispatch('keydown', keyboardEvent({ code: 'AltLeft', key: 'Alt', altKey: true }))

    expect(emit).toHaveBeenNthCalledWith(1, expect.objectContaining({
      phase: 'trigger',
      gesture: 'hold',
    }))
    expect(emit).toHaveBeenNthCalledWith(2, expect.objectContaining({
      phase: 'release',
      gesture: 'hold',
    }))

    runtime.dispose()
  })

  it('modifier 松开后普通键不会带上已经释放的物理侧别', () => {
    const emit = vi.fn()
    const runtime = createBrowserShortcutRuntime({
      bindings: {
        recording: {
          scope: 'local',
          gesture: 'press',
          chord: { source: 'keyboard', key: 'B', modifiers: ['AltRight'] },
        },
      },
      capabilities: WEB_SHORTCUT_CAPABILITIES,
      canHandle: () => true,
      emit,
    })

    dispatch('keydown', keyboardEvent({ code: 'AltRight', key: 'Alt', altKey: true }))
    dispatch('keydown', keyboardEvent({ code: 'KeyA', key: 'a', altKey: true }))
    dispatch('keyup', keyboardEvent({ code: 'AltRight', key: 'Alt', altKey: false }))
    dispatch('keydown', keyboardEvent({ code: 'KeyB', key: 'b', altKey: false }))
    dispatch('keyup', keyboardEvent({ code: 'KeyB', key: 'b', altKey: false }))

    expect(emit).not.toHaveBeenCalled()

    runtime.dispose()
  })
})

function dispatch(type: 'keydown' | 'keyup', event: KeyboardEvent): void {
  harness.listeners.get(type)?.(event)
}

function keyboardEvent(
  fields: Pick<KeyboardEvent, 'code' | 'key'> & Partial<KeyboardEvent>,
): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...fields,
  } as KeyboardEvent
}

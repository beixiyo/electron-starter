/** 验证 uiohook 录制边界保留左右物理修饰键，并输出可持久化 chord */
import type { UiohookKeyboardEvent } from 'uiohook-napi'
import { UiohookKey } from 'uiohook-napi'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startRecordShortcutDetection, stopRecordShortcutDetection } from './detector'

const harness = vi.hoisted(() => ({
  keydown: null as ((event: UiohookKeyboardEvent) => void) | null,
  keyup: null as ((event: UiohookKeyboardEvent) => void) | null,
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

describe('全局快捷键录制', () => {
  afterEach(() => {
    stopRecordShortcutDetection()
  })

  it.each([
    ['AltLeft', UiohookKey.Alt],
    ['AltRight', UiohookKey.AltRight],
  ] as const)('保留 %s 的物理侧别', (key, keycode) => {
    const events: unknown[] = []
    startRecordShortcutDetection(event => events.push(event))

    harness.keydown?.(keyboardEvent(keycode, true))
    harness.keyup?.(keyboardEvent(keycode, false))

    expect(events).toEqual([
      {
        phase: 'down',
        chord: { source: 'keyboard', key, modifiers: [] },
        timestamp: expect.any(Number),
      },
      {
        phase: 'up',
        chord: { source: 'keyboard', key, modifiers: [] },
        timestamp: expect.any(Number),
      },
    ])
  })

  it('modifier 先松开时结束完整 chord，后续按键不再继承该侧别', () => {
    const events: Array<{
      phase: string
      chord: { key: string, modifiers?: string[] }
    }> = []
    startRecordShortcutDetection(event => events.push(event))

    harness.keydown?.(keyboardEvent(UiohookKey.AltRight, true))
    harness.keydown?.(keyboardEvent(UiohookKey.A, true))
    harness.keyup?.(keyboardEvent(UiohookKey.AltRight, false))
    harness.keydown?.(keyboardEvent(UiohookKey.B, false))

    expect(events.map(event => ({
      phase: event.phase,
      key: event.chord.key,
      modifiers: event.chord.modifiers ?? [],
    }))).toEqual([
      { phase: 'down', key: 'AltRight', modifiers: [] },
      { phase: 'down', key: 'A', modifiers: ['AltRight'] },
      { phase: 'up', key: 'A', modifiers: ['AltRight'] },
      { phase: 'up', key: 'AltRight', modifiers: [] },
      { phase: 'down', key: 'B', modifiers: [] },
    ])
  })
})

function keyboardEvent(keycode: number, altKey: boolean): UiohookKeyboardEvent {
  return {
    keycode,
    altKey,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  } as UiohookKeyboardEvent
}

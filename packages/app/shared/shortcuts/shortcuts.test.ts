import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_KEYBOARD_BINDINGS,
  getShortcutActionRecordGestures,
  isShortcutGestureBindingSupportedByAction,
  MAC_DEFAULT_BINDINGS,
  SHORTCUT_ACTIONS,
} from './actions'
import type { BrowserShortcutKeyEvent } from './browser-key'
import { normalizeBrowserShortcutKey, toBrowserKeyboardInputEvent } from './browser-key'
import { createElectronShortcutCapabilities, resolveEffectiveShortcutScope, toEffectiveShortcutBindings } from './capabilities'
import { createShortcutGestureEngine } from './gesture-engine'
import type { KeyboardInputTracker } from './input-tracker'
import { createKeyboardInputTracker } from './input-tracker'
import type { KeyboardModifierCode, KeyboardShortcutChord, ShortcutBinding } from './types'
import {
  keyboardShortcutChordMatchesModifierState,
  normalizeKeyboardCode,
  normalizeKeyboardShortcutChord,
  normalizeShortcutBinding,
  normalizeShortcutBindingsOrThrow,
  resolveShortcutBindingConflicts,
  shortcutBindingsConflict,
  shortcutChordsEqual,
} from './utils'

describe('快捷键键名规范化', () => {
  it('浏览器键码与持久化绑定使用相同键名，后端私有键名不在持久化边界做别名兜底', () => {
    expect(normalizeBrowserShortcutKey({ code: 'KeyA', key: 'a' })).toBe('A')
    expect(normalizeBrowserShortcutKey({ code: 'Backquote', key: '`' })).toBe('Backquote')
    expect(normalizeShortcutBinding({
      scope: 'global',
      gesture: 'press',
      chord: { source: 'keyboard', key: 'Grave', modifiers: [] },
    })).toBeNull()
    expect(
      normalizeShortcutBinding({
        scope: 'global',
        gesture: 'press',
        chord: { source: 'fn', key: 'Backquote' },
      })?.chord,
    ).toEqual({ source: 'fn', key: 'Backquote', modifiers: [] })
  })

  it('拒绝未知键盘按键而不是将其持久化', () => {
    expect(normalizeBrowserShortcutKey({ code: 'UnknownKey', key: 'UnknownKey' })).toBeNull()
    expect(() =>
      normalizeShortcutBindingsOrThrow({
        recording: {
          scope: 'global',
          gesture: 'press',
          chord: { source: 'keyboard', key: 'UnknownKey', modifiers: [] },
        },
      })
    ).toThrow('recording')
  })

  it('Fn chord 拒绝当前平台重复声明同一逻辑 modifier 家族', () => {
    const primaryModifier = process.platform === 'darwin'
      ? 'Meta'
      : 'Control'
    const binding = {
      scope: 'global',
      gesture: 'press',
      chord: {
        source: 'fn',
        key: 'Space',
        modifiers: ['Primary', primaryModifier],
      },
    } as const

    expect(normalizeShortcutBinding(binding)).toBeNull()
    expect(() => normalizeShortcutBindingsOrThrow({ recording: binding })).toThrow('recording')
  })

  it('Fn 与修饰键的组合保留 modifier，且与裸 Fn 区分', () => {
    const fnMeta = normalizeShortcutBinding({
      scope: 'global',
      gesture: 'press',
      chord: { source: 'fn', key: 'Fn', modifiers: ['Meta'] },
    })!.chord
    const bareFn = normalizeShortcutBinding({
      scope: 'global',
      gesture: 'press',
      chord: { source: 'fn', key: 'Fn' },
    })!.chord

    expect(fnMeta).toEqual({ source: 'fn', key: 'Fn', modifiers: ['Meta'] })
    expect(bareFn).toEqual({ source: 'fn', key: 'Fn' })
    expect(shortcutChordsEqual(fnMeta, bareFn)).toBe(false)
    expect(shortcutBindingsConflict(
      { gesture: 'press', chord: fnMeta },
      { gesture: 'press', chord: bareFn },
    )).toBe(false)
  })

  it('方向键组合按成员顺序归一，跨组成员在持久化边界拒绝', () => {
    const upLeft = normalizeKeyboardShortcutChord('ArrowLeft', [], ['ArrowUp'])

    expect(upLeft).toEqual({
      source: 'keyboard',
      key: 'ArrowUp',
      modifiers: [],
      keys: ['ArrowLeft'],
    })
    expect(shortcutChordsEqual(
      upLeft,
      normalizeKeyboardShortcutChord('ArrowUp', [], ['ArrowLeft']),
    )).toBe(true)
    expect(normalizeShortcutBinding({
      scope: 'global',
      gesture: 'press',
      chord: { source: 'keyboard', key: 'ArrowUp', modifiers: [], keys: ['A'] },
    })).toBeNull()
    expect(shortcutBindingsConflict(
      { gesture: 'press', chord: upLeft },
      { gesture: 'press', chord: normalizeKeyboardShortcutChord('ArrowUp', [], ['ArrowLeft']) },
    )).toBe(true)
  })

  it('只接受带左右侧的物理修饰键主键', () => {
    expect(normalizeBrowserShortcutKey({ code: 'MetaLeft', key: 'Meta' })).toBe('MetaLeft')
    expect(normalizeBrowserShortcutKey({ code: 'ControlRight', key: 'Control' })).toBe('ControlRight')
    expect(normalizeKeyboardCode('AltRight')).toBe('AltRight')
    expect(normalizeKeyboardCode('Shift')).toBeNull()
    expect(() =>
      normalizeShortcutBindingsOrThrow({
        voiceDictation: {
          scope: 'global',
          gesture: 'press',
          chord: { source: 'keyboard', key: 'Alt', modifiers: [] },
        },
      })
    ).toThrow('voiceDictation')
  })

  it('单独按下和松开右侧 Option 时保留物理侧别', () => {
    const tracker = createKeyboardInputTracker()
    const down = browserEvents(tracker, {
      code: 'AltRight',
      key: 'Alt',
      altKey: true,
    }, 'down')[0]
    const up = browserEvents(tracker, {
      code: 'AltRight',
      key: 'Alt',
      altKey: false,
    }, 'up')[0]

    expect(down?.chord).toEqual({
      source: 'keyboard',
      key: 'AltRight',
      modifiers: [],
    })
    expect(up?.chord).toEqual(down?.chord)
  })

  it('修饰键作为主键时排除自身标志，并在 keyup 复用按下时的 chord', () => {
    const tracker = createKeyboardInputTracker()
    browserEvents(tracker, {
      code: 'MetaRight',
      key: 'Meta',
      metaKey: true,
    }, 'down')
    const down = browserEvents(tracker, {
      code: 'AltLeft',
      key: 'Alt',
      altKey: true,
      metaKey: true,
    }, 'down')[0]
    const up = browserEvents(tracker, {
      code: 'AltLeft',
      key: 'Alt',
      altKey: false,
      metaKey: false,
    }, 'up')[0]

    expect(down?.chord).toEqual({
      source: 'keyboard',
      key: 'MetaRight',
      modifiers: ['AltLeft'],
    })
    expect(up?.chord).toEqual(down?.chord)
  })

  it('纯修饰键组合不受按下和松开顺序影响', () => {
    const firstTracker = createKeyboardInputTracker()
    browserEvents(firstTracker, { code: 'MetaLeft', key: 'Meta', metaKey: true }, 'down')
    const metaThenAlt = browserEvents(firstTracker, {
      code: 'AltLeft',
      key: 'Alt',
      altKey: true,
      metaKey: true,
    }, 'down')[0]
    const releaseMetaFirst = browserEvents(firstTracker, {
      code: 'MetaLeft',
      key: 'Meta',
      altKey: true,
    }, 'up')[0]

    const secondTracker = createKeyboardInputTracker()
    browserEvents(secondTracker, { code: 'AltLeft', key: 'Alt', altKey: true }, 'down')
    const altThenMeta = browserEvents(secondTracker, {
      code: 'MetaLeft',
      key: 'Meta',
      altKey: true,
      metaKey: true,
    }, 'down')[0]
    const releaseAltFirst = browserEvents(secondTracker, {
      code: 'AltLeft',
      key: 'Alt',
      metaKey: true,
    }, 'up')[0]

    const expected = { source: 'keyboard', key: 'MetaLeft', modifiers: ['AltLeft'] }
    expect(metaThenAlt?.chord).toEqual(expected)
    expect(altThenMeta?.chord).toEqual(expected)
    expect(releaseMetaFirst?.chord).toEqual(expected)
    expect(releaseAltFirst?.chord).toEqual(expected)
  })

  it('普通主键组合保留已按住修饰键的物理侧别', () => {
    const tracker = createKeyboardInputTracker()
    browserEvents(tracker, {
      code: 'AltRight',
      key: 'Alt',
      altKey: true,
    }, 'down')

    const down = browserEvents(tracker, {
      code: 'KeyA',
      key: 'a',
      altKey: true,
    }, 'down')[0]

    expect(down?.chord).toEqual({
      source: 'keyboard',
      key: 'A',
      modifiers: ['AltRight'],
    })
  })

  it('任一组合成员松开后清理依赖 chord，后续按键不会继承幽灵 modifier', () => {
    const tracker = createKeyboardInputTracker()
    browserEvents(tracker, {
      code: 'AltRight',
      key: 'Alt',
      altKey: true,
    }, 'down')
    browserEvents(tracker, {
      code: 'KeyA',
      key: 'a',
      altKey: true,
    }, 'down')

    const released = browserEvents(tracker, {
      code: 'AltRight',
      key: 'Alt',
      altKey: false,
    }, 'up')
    const next = browserEvents(tracker, {
      code: 'KeyB',
      key: 'b',
      altKey: false,
    }, 'down')[0]
    /** 仍按住的 A 已按当前 modifier 状态重算，松开时不应再带上已经松开的 AltRight */
    const releasedA = browserEvents(tracker, {
      code: 'KeyA',
      key: 'a',
      altKey: false,
    }, 'up')[0]

    expect(released[0]?.chord).toEqual({
      source: 'keyboard',
      key: 'A',
      modifiers: ['AltRight'],
    })
    expect(releasedA?.chord).toEqual({
      source: 'keyboard',
      key: 'A',
      modifiers: [],
    })
    expect(next?.chord).toEqual({
      source: 'keyboard',
      key: 'B',
      modifiers: [],
    })
  })

  it('拒绝同一 modifier 家族混用逻辑 token 与物理侧别', () => {
    expect(normalizeShortcutBinding({
      scope: 'global',
      gesture: 'press',
      chord: { source: 'keyboard', key: 'A', modifiers: ['AltLeft', 'Alt'] },
    })).toBeNull()
    expect(() =>
      normalizeShortcutBindingsOrThrow({
        recording: {
          scope: 'global',
          gesture: 'press',
          chord: { source: 'keyboard', key: 'A', modifiers: ['AltLeft', 'Alt'] },
        },
      })
    ).toThrow('recording')
  })

  it('物理 modifier 主键不能叠加当前平台等价的 Primary', () => {
    const key: KeyboardModifierCode = process.platform === 'darwin'
      ? 'MetaRight'
      : 'ControlRight'
    const logicalModifier = process.platform === 'darwin'
      ? 'Meta'
      : 'Control'
    const exactChord: KeyboardShortcutChord = {
      source: 'keyboard',
      key,
      modifiers: [],
    }
    const mixedChord: KeyboardShortcutChord = {
      source: 'keyboard',
      key,
      modifiers: ['Primary'],
    }
    const exact: ShortcutBinding = {
      scope: 'global',
      gesture: 'press',
      chord: exactChord,
    }
    const mixed: ShortcutBinding = {
      scope: 'global',
      gesture: 'press',
      chord: mixedChord,
    }

    expect(normalizeShortcutBinding(mixed)).toBeNull()
    expect(normalizeShortcutBinding({
      ...mixed,
      chord: { source: 'keyboard', key: 'MetaRight', modifiers: ['Meta'] },
    })).toBeNull()
    expect(keyboardShortcutChordMatchesModifierState(
      exactChord,
      new Set([key]),
      [logicalModifier],
    )).toBe(true)
    expect(keyboardShortcutChordMatchesModifierState(
      mixedChord,
      new Set([key]),
      [logicalModifier],
    )).toBe(true)
    expect(shortcutBindingsConflict(exact, mixed)).toBe(true)
    expect(resolveShortcutBindingConflicts({ exact, mixed })).toEqual({
      exact: null,
      mixed,
    })
  })

  it('拒绝 Primary 与当前平台逻辑 modifier 重复声明同一家族', () => {
    const logicalModifier = process.platform === 'darwin'
      ? 'Meta'
      : 'Control'
    const exact: ShortcutBinding = {
      scope: 'global',
      gesture: 'press',
      chord: { source: 'keyboard', key: 'A', modifiers: ['Primary'] },
    }
    const duplicate: ShortcutBinding = {
      scope: 'global',
      gesture: 'press',
      chord: { source: 'keyboard', key: 'A', modifiers: ['Primary', logicalModifier] },
    }

    expect(normalizeShortcutBinding(duplicate)).toBeNull()
    expect(normalizeKeyboardShortcutChord('A', ['Primary', logicalModifier])).toEqual({
      source: 'keyboard',
      key: 'A',
      modifiers: ['Primary'],
    })
    expect(shortcutBindingsConflict(exact, duplicate)).toBe(true)
  })
})

describe('浏览器快捷键运行时生命周期', () => {
  afterEach(() => vi.useRealTimers())

  it('modifier 先松开时立即结束完整 chord 的 hold', async () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const chord = { source: 'keyboard', key: 'A', modifiers: ['AltRight'] } as const
    const engine = createShortcutGestureEngine({
      entries: [{
        id: 'voiceDictation',
        binding: {
          scope: 'local',
          gesture: 'hold',
          chord: { ...chord, modifiers: [...chord.modifiers] },
        },
      }],
      emit,
    })
    const tracker = createKeyboardInputTracker()

    for (
      const event of browserEvents(tracker, {
        code: 'AltRight',
        key: 'Alt',
        altKey: true,
      }, 'down')
    ) engine.handle(event)
    for (
      const event of browserEvents(tracker, {
        code: 'KeyA',
        key: 'a',
        altKey: true,
      }, 'down')
    ) engine.handle(event)

    await vi.advanceTimersByTimeAsync(300)
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'trigger',
      gesture: 'hold',
    }))

    for (
      const event of browserEvents(tracker, {
        code: 'AltRight',
        key: 'Alt',
        altKey: false,
      }, 'up')
    ) engine.handle(event)

    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: 'release',
      gesture: 'hold',
    }))
  })

  it('运行时把物理主键与冗余逻辑 modifier 视为同一 chord', () => {
    const key: KeyboardModifierCode = process.platform === 'darwin'
      ? 'MetaRight'
      : 'ControlRight'
    const emit = vi.fn()
    const engine = createShortcutGestureEngine({
      entries: [{
        id: 'voiceDictation',
        binding: {
          scope: 'local',
          gesture: 'press',
          chord: { source: 'keyboard', key, modifiers: ['Primary'] },
        },
      }],
      emit,
    })
    const eventChord: KeyboardShortcutChord = { source: 'keyboard', key, modifiers: [] }

    engine.handle({ phase: 'down', chord: eventChord, timestamp: 0 })
    engine.handle({ phase: 'up', chord: eventChord, timestamp: 1 })

    expect(emit).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'trigger',
      gesture: 'press',
    }))
  })

  it('逻辑 modifier 接受同家族左右两侧，物理 binding 仍要求精确侧别', () => {
    const primaryLeft: KeyboardModifierCode = process.platform === 'darwin'
      ? 'MetaLeft'
      : 'ControlLeft'
    const primaryRight: KeyboardModifierCode = process.platform === 'darwin'
      ? 'MetaRight'
      : 'ControlRight'
    const primaryLogical = process.platform === 'darwin'
      ? 'Meta'
      : 'Control'
    const logicalChord: KeyboardShortcutChord = {
      source: 'keyboard',
      key: 'A',
      modifiers: ['Primary', 'Shift'],
    }
    const physicalChord = normalizeKeyboardShortcutChord('A', [
      primaryLeft,
      primaryRight,
      'ShiftLeft',
    ])
    const physicalBinding: KeyboardShortcutChord = {
      source: 'keyboard',
      key: 'A',
      modifiers: [primaryLeft, 'ShiftLeft'],
    }
    const physicalState = new Set<KeyboardModifierCode>([
      primaryLeft,
      primaryRight,
      'ShiftLeft',
    ])

    expect(keyboardShortcutChordMatchesModifierState(
      logicalChord,
      physicalState,
      [primaryLogical, 'Shift'],
    )).toBe(true)
    expect(shortcutChordsEqual(logicalChord, physicalChord)).toBe(true)
    expect(keyboardShortcutChordMatchesModifierState(
      physicalBinding,
      physicalState,
      [primaryLogical, 'Shift'],
    )).toBe(false)
    expect(shortcutChordsEqual(physicalBinding, physicalChord)).toBe(false)

    const emit = vi.fn()
    const engine = createShortcutGestureEngine({
      entries: [{
        id: 'recording',
        binding: {
          scope: 'local',
          gesture: 'press',
          chord: logicalChord,
        },
      }],
      emit,
    })
    engine.handle({ phase: 'down', chord: physicalChord, timestamp: 0 })
    engine.handle({ phase: 'up', chord: physicalChord, timestamp: 1 })

    expect(emit).toHaveBeenCalledOnce()
  })

  it('运行时按方向键组合 chord 触发，单独方向键不触发', () => {
    const emit = vi.fn()
    const engine = createShortcutGestureEngine({
      entries: [{
        id: 'recording',
        binding: {
          scope: 'local',
          gesture: 'press',
          chord: {
            source: 'keyboard',
            key: 'ArrowUp',
            modifiers: [],
            keys: ['ArrowLeft'],
          },
        },
      }],
      emit,
    })
    const tracker = createKeyboardInputTracker()

    for (const event of browserEvents(tracker, { code: 'ArrowUp', key: 'ArrowUp' }, 'down')) engine.handle(event)
    for (const event of browserEvents(tracker, { code: 'ArrowUp', key: 'ArrowUp' }, 'up')) engine.handle(event)
    for (const event of browserEvents(tracker, { code: 'ArrowLeft', key: 'ArrowLeft' }, 'down')) engine.handle(event)
    for (const event of browserEvents(tracker, { code: 'ArrowUp', key: 'ArrowUp' }, 'down')) engine.handle(event)
    for (const event of browserEvents(tracker, { code: 'ArrowLeft', key: 'ArrowLeft' }, 'up')) engine.handle(event)
    for (const event of browserEvents(tracker, { code: 'ArrowUp', key: 'ArrowUp' }, 'up')) engine.handle(event)

    expect(emit).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'trigger',
      gesture: 'press',
    }))
  })
})

describe('跨平台快捷键默认值', () => {
  it('macOS 保留 Fn 默认值，其他平台提供普通键盘默认值', () => {
    expect(MAC_DEFAULT_BINDINGS.recording?.chord.source).toBe('fn')
    expect(DEFAULT_KEYBOARD_BINDINGS.recording).toMatchObject({
      scope: 'global',
      chord: { source: 'keyboard', key: 'R', modifiers: ['Primary', 'Shift'] },
    })
  })

  it('由 action activation 声明语音听写的 toggle 手势', () => {
    const action = SHORTCUT_ACTIONS.find((item) => item.id === 'voiceDictation')!

    expect(action.activation).toBe('toggle')
    expect(MAC_DEFAULT_BINDINGS.voiceDictation?.gesture).toBe('press')
    expect(DEFAULT_KEYBOARD_BINDINGS.voiceDictation?.gesture).toBe('press')
    expect(getShortcutActionRecordGestures(action)).toEqual(['press', 'doublePress'])
    expect(isShortcutGestureBindingSupportedByAction(action, {
      gesture: 'press',
      chord: { source: 'keyboard', key: 'AltRight', modifiers: [] },
    })).toBe(true)
    expect(isShortcutGestureBindingSupportedByAction(action, {
      gesture: 'press',
      chord: { source: 'keyboard', key: 'V', modifiers: ['Primary', 'Shift'] },
    })).toBe(true)
  })

  /**
   * 裸 Fn 上单击与双击并存时，引擎收到单击的松开后必须等满双击判定窗口（300ms）才能派发，
   * 语音听写这条主动作每次都慢一拍。默认值曾经就是这样（助手 = 裸 Fn 双击），这里锁住不再回去
   */
  it('默认绑定不在裸 Fn 上同时挂单击与双击', () => {
    const bareFnGestures = Object.values(MAC_DEFAULT_BINDINGS)
      .filter((binding) => binding?.chord.source === 'fn' && binding.chord.key === 'Fn')
      .map((binding) => binding!.gesture)

    expect(bareFnGestures).toContain('press')
    expect(bareFnGestures).not.toContain('doublePress')
  })

  it('所有普通键盘动作同时接受单键和组合键', () => {
    for (const action of SHORTCUT_ACTIONS) {
      const gesture = getShortcutActionRecordGestures(action)[0]

      expect(isShortcutGestureBindingSupportedByAction(action, {
        gesture,
        chord: { source: 'keyboard', key: 'A', modifiers: [] },
      })).toBe(true)
      expect(isShortcutGestureBindingSupportedByAction(action, {
        gesture,
        chord: { source: 'keyboard', key: 'A', modifiers: ['Primary'] },
      })).toBe(true)
    }
  })
})

describe('快捷键实际生效作用域', () => {
  const keyboardBinding: ShortcutBinding = {
    scope: 'global',
    gesture: 'press',
    chord: { source: 'keyboard', key: 'R', modifiers: [] },
  }

  it('系统捕获可用时保持全局作用域，降级时不修改持久化数据', () => {
    const available = createCapabilities(true)
    const degraded = createCapabilities(false)

    expect(resolveEffectiveShortcutScope(keyboardBinding, available)).toBe('global')
    expect(resolveEffectiveShortcutScope(keyboardBinding, degraded)).toBe('local')
    expect(toEffectiveShortcutBindings({ recording: keyboardBinding }, degraded).recording?.scope).toBe('local')
    expect(keyboardBinding.scope).toBe('global')
  })

  it('不提升局部绑定，并拒绝两种作用域都不可用的 Fn 手势', () => {
    expect(resolveEffectiveShortcutScope(
      { ...keyboardBinding, scope: 'local' },
      createCapabilities(true),
    )).toBe('local')
    expect(resolveEffectiveShortcutScope({
      scope: 'global',
      gesture: 'hold',
      chord: { source: 'fn', key: 'Fn' },
    }, createCapabilities(false))).toBeNull()
  })
})

describe('函数键手势能力', () => {
  it('完整物理相位允许 Fn 单键和组合键使用全部手势', () => {
    expect(resolveEffectiveShortcutScope({
      scope: 'global',
      gesture: 'press',
      chord: { source: 'fn', key: 'Fn' },
    }, createCapabilities(true, true))).toBe('global')

    expect(resolveEffectiveShortcutScope({
      scope: 'global',
      gesture: 'hold',
      chord: { source: 'fn', key: 'Space' },
    }, createCapabilities(true, true))).toBe('global')
  })
})

/** 把 DOM 事件经浏览器 adapter 与 tracker 合成为 chord 事件 */
function browserEvents(
  tracker: KeyboardInputTracker,
  event: BrowserShortcutKeyEvent,
  phase: 'down' | 'up',
) {
  const input = toBrowserKeyboardInputEvent(event, phase)
  return input
    ? tracker.handle(input)
    : []
}

function createCapabilities(globalKeyboard: boolean, fn = false) {
  return createElectronShortcutCapabilities({
    providers: [],
    global: { keyboard: globalKeyboard, fn },
    local: { keyboard: true, fn },
  })
}

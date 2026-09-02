import type {
  ActiveKeyboardShortcutEntry,
  KeyboardModifierCode,
  KeyboardShortcutChord,
  ShortcutBinding,
} from './types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_KEYBOARD_BINDINGS,
  getShortcutActionSupportedGestures,
  isShortcutGestureBindingSupportedByAction,
  MAC_DEFAULT_BINDINGS,
  SHORTCUT_ACTIONS,
} from './actions'
import { normalizeBrowserShortcutKey, toBrowserShortcutChord, toBrowserShortcutRecordEvents } from './browser-key'
import { createElectronShortcutCapabilities, resolveEffectiveShortcutScope, toEffectiveShortcutBindings } from './capabilities'
import { createShortcutGestureEngine } from './gesture-engine'
import {
  normalizeKeyboardCode,
  normalizeKeyboardShortcutChord,
  normalizeShortcutBinding,
  normalizeShortcutBindingsOrThrow,
  resolveShortcutBindingConflicts,
  keyboardShortcutChordMatchesModifierState,
  shortcutBindingsConflict,
  shortcutChordsEqual,
} from './utils'

describe('快捷键键名规范化', () => {
  it('浏览器键码与持久化绑定使用相同键名', () => {
    expect(normalizeBrowserShortcutKey({ code: 'KeyA', key: 'a' })).toBe('A')
    expect(normalizeBrowserShortcutKey({ code: 'Backquote', key: '`' })).toBe('Backquote')
    expect(normalizeShortcutBinding({
      scope: 'global',
      gesture: 'press',
      chord: { source: 'keyboard', key: 'Grave', modifiers: [] },
    })?.chord).toEqual({
      source: 'keyboard',
      key: 'Backquote',
      modifiers: [],
    })
  })

  it('拒绝未知键盘按键而不是将其持久化', () => {
    expect(toBrowserShortcutChord({ code: 'UnknownKey', key: 'UnknownKey' })).toBeNull()
    expect(() => normalizeShortcutBindingsOrThrow({
      recording: {
        scope: 'global',
        gesture: 'press',
        chord: { source: 'keyboard', key: 'UnknownKey', modifiers: [] },
      },
    })).toThrow('recording')
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

  it('只接受带左右侧的物理修饰键主键', () => {
    expect(normalizeBrowserShortcutKey({ code: 'MetaLeft', key: 'Meta' })).toBe('MetaLeft')
    expect(normalizeBrowserShortcutKey({ code: 'ControlRight', key: 'Control' })).toBe('ControlRight')
    expect(normalizeKeyboardCode('AltRight')).toBe('AltRight')
    expect(normalizeKeyboardCode('Shift')).toBeNull()
    expect(() => normalizeShortcutBindingsOrThrow({
      voiceDictation: {
        scope: 'global',
        gesture: 'press',
        chord: { source: 'keyboard', key: 'Alt', modifiers: [] },
      },
    })).toThrow('voiceDictation')
  })

  it('单独按下和松开右侧 Option 时保留物理侧别', () => {
    const activeEntries = new Map<string, ActiveKeyboardShortcutEntry>()
    const down = toBrowserShortcutRecordEvents({
      code: 'AltRight',
      key: 'Alt',
      altKey: true,
    }, 'down', activeEntries)[0]
    const up = toBrowserShortcutRecordEvents({
      code: 'AltRight',
      key: 'Alt',
      altKey: false,
    }, 'up', activeEntries)[0]

    expect(down?.chord).toEqual({
      source: 'keyboard',
      key: 'AltRight',
      modifiers: [],
    })
    expect(up?.chord).toEqual(down?.chord)
  })

  it('修饰键作为主键时排除自身标志，并在 keyup 复用按下时的 chord', () => {
    const activeEntries = new Map<string, ActiveKeyboardShortcutEntry>()
    toBrowserShortcutRecordEvents({
      code: 'MetaRight',
      key: 'Meta',
      metaKey: true,
    }, 'down', activeEntries)
    const down = toBrowserShortcutRecordEvents({
      code: 'AltLeft',
      key: 'Alt',
      altKey: true,
      metaKey: true,
    }, 'down', activeEntries)[0]
    const up = toBrowserShortcutRecordEvents({
      code: 'AltLeft',
      key: 'Alt',
      altKey: false,
      metaKey: false,
    }, 'up', activeEntries)[0]

    expect(down?.chord).toEqual({
      source: 'keyboard',
      key: 'MetaRight',
      modifiers: ['AltLeft'],
    })
    expect(up?.chord).toEqual(down?.chord)
  })

  it('纯修饰键组合不受按下和松开顺序影响', () => {
    const firstActive = new Map<string, ActiveKeyboardShortcutEntry>()
    toBrowserShortcutRecordEvents({ code: 'MetaLeft', key: 'Meta', metaKey: true }, 'down', firstActive)
    const metaThenAlt = toBrowserShortcutRecordEvents({
      code: 'AltLeft',
      key: 'Alt',
      altKey: true,
      metaKey: true,
    }, 'down', firstActive)[0]
    const releaseMetaFirst = toBrowserShortcutRecordEvents({
      code: 'MetaLeft',
      key: 'Meta',
      altKey: true,
    }, 'up', firstActive)[0]

    const secondActive = new Map<string, ActiveKeyboardShortcutEntry>()
    toBrowserShortcutRecordEvents({ code: 'AltLeft', key: 'Alt', altKey: true }, 'down', secondActive)
    const altThenMeta = toBrowserShortcutRecordEvents({
      code: 'MetaLeft',
      key: 'Meta',
      altKey: true,
      metaKey: true,
    }, 'down', secondActive)[0]
    const releaseAltFirst = toBrowserShortcutRecordEvents({
      code: 'AltLeft',
      key: 'Alt',
      metaKey: true,
    }, 'up', secondActive)[0]

    const expected = { source: 'keyboard', key: 'MetaLeft', modifiers: ['AltLeft'] }
    expect(metaThenAlt?.chord).toEqual(expected)
    expect(altThenMeta?.chord).toEqual(expected)
    expect(releaseMetaFirst?.chord).toEqual(expected)
    expect(releaseAltFirst?.chord).toEqual(expected)
  })

  it('普通主键组合保留已按住修饰键的物理侧别', () => {
    const activeEntries = new Map<string, ActiveKeyboardShortcutEntry>()
    toBrowserShortcutRecordEvents({
      code: 'AltRight',
      key: 'Alt',
      altKey: true,
    }, 'down', activeEntries)

    const down = toBrowserShortcutRecordEvents({
      code: 'KeyA',
      key: 'a',
      altKey: true,
    }, 'down', activeEntries)[0]

    expect(down?.chord).toEqual({
      source: 'keyboard',
      key: 'A',
      modifiers: ['AltRight'],
    })
  })

  it('任一组合成员松开后清理依赖 chord，后续按键不会继承幽灵 modifier', () => {
    const activeEntries = new Map<string, ActiveKeyboardShortcutEntry>()
    toBrowserShortcutRecordEvents({
      code: 'AltRight',
      key: 'Alt',
      altKey: true,
    }, 'down', activeEntries)
    toBrowserShortcutRecordEvents({
      code: 'KeyA',
      key: 'a',
      altKey: true,
    }, 'down', activeEntries)

    const released = toBrowserShortcutRecordEvents({
      code: 'AltRight',
      key: 'Alt',
      altKey: false,
    }, 'up', activeEntries)
    const next = toBrowserShortcutRecordEvents({
      code: 'KeyB',
      key: 'b',
      altKey: false,
    }, 'down', activeEntries)[0]

    expect(released[0]?.chord).toEqual({
      source: 'keyboard',
      key: 'A',
      modifiers: ['AltRight'],
    })
    expect(activeEntries.get('KeyA')?.chord).toEqual({
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
    expect(() => normalizeShortcutBindingsOrThrow({
      recording: {
        scope: 'global',
        gesture: 'press',
        chord: { source: 'keyboard', key: 'A', modifiers: ['AltLeft', 'Alt'] },
      },
    })).toThrow('recording')
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
    const activeEntries = new Map<string, ActiveKeyboardShortcutEntry>()

    for (const event of toBrowserShortcutRecordEvents({
      code: 'AltRight',
      key: 'Alt',
      altKey: true,
    }, 'down', activeEntries))
      engine.handle(event)
    for (const event of toBrowserShortcutRecordEvents({
      code: 'KeyA',
      key: 'a',
      altKey: true,
    }, 'down', activeEntries))
      engine.handle(event)

    await vi.advanceTimersByTimeAsync(300)
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'trigger',
      gesture: 'hold',
    }))

    for (const event of toBrowserShortcutRecordEvents({
      code: 'AltRight',
      key: 'Alt',
      altKey: false,
    }, 'up', activeEntries))
      engine.handle(event)

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
    const action = SHORTCUT_ACTIONS.find(item => item.id === 'voiceDictation')!

    expect(action.activation).toBe('toggle')
    expect(MAC_DEFAULT_BINDINGS.voiceDictation?.gesture).toBe('press')
    expect(DEFAULT_KEYBOARD_BINDINGS.voiceDictation?.gesture).toBe('press')
    expect(getShortcutActionSupportedGestures(action)).toEqual(['press'])
    expect(isShortcutGestureBindingSupportedByAction(action, {
      gesture: 'press',
      chord: { source: 'keyboard', key: 'AltRight', modifiers: [] },
    })).toBe(true)
    expect(isShortcutGestureBindingSupportedByAction(action, {
      gesture: 'press',
      chord: { source: 'keyboard', key: 'V', modifiers: ['Primary', 'Shift'] },
    })).toBe(true)
  })

  it('所有普通键盘动作同时接受单键和组合键', () => {
    for (const action of SHORTCUT_ACTIONS) {
      const gesture = getShortcutActionSupportedGestures(action)[0]

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

function createCapabilities(globalKeyboard: boolean, fn = false) {
  return createElectronShortcutCapabilities({
    providers: [],
    global: { keyboard: globalKeyboard, fn },
    local: { keyboard: true, fn },
  })
}

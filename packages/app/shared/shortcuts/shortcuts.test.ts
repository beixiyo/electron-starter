import type { ShortcutBinding } from './types'
import { describe, expect, it } from 'vitest'
import { DEFAULT_KEYBOARD_BINDINGS, getShortcutActionSupportedGestures, MAC_DEFAULT_BINDINGS, SHORTCUT_ACTIONS } from './actions'
import { normalizeBrowserShortcutKey, toBrowserShortcutChord, toBrowserShortcutRecordEvent } from './browser-key'
import { createElectronShortcutCapabilities, resolveEffectiveShortcutScope, toEffectiveShortcutBindings } from './capabilities'
import { normalizeKeyboardCode, normalizeShortcutBinding, normalizeShortcutBindingsOrThrow } from './utils'

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

  it('将左右物理修饰键归一为可持久化的逻辑主键', () => {
    expect(normalizeBrowserShortcutKey({ code: 'MetaLeft', key: 'Meta' })).toBe('Meta')
    expect(normalizeBrowserShortcutKey({ code: 'ControlRight', key: 'Control' })).toBe('Control')
    expect(normalizeKeyboardCode('AltRight')).toBe('Alt')
    expect(normalizeKeyboardCode('Shift')).toBe('Shift')
  })

  it('修饰键作为主键时排除自身标志，并在 keyup 复用按下时的 chord', () => {
    const activeChords = new Map()
    const down = toBrowserShortcutRecordEvent({
      code: 'AltLeft',
      key: 'Alt',
      altKey: true,
      metaKey: true,
    }, 'down', activeChords)
    const up = toBrowserShortcutRecordEvent({
      code: 'AltLeft',
      key: 'Alt',
      altKey: false,
      metaKey: false,
    }, 'up', activeChords)

    expect(down?.chord).toEqual({
      source: 'keyboard',
      key: 'Meta',
      modifiers: ['Alt'],
    })
    expect(up?.chord).toEqual(down?.chord)
  })

  it('纯修饰键组合不受按下和松开顺序影响', () => {
    const firstActive = new Map()
    toBrowserShortcutRecordEvent({ code: 'MetaLeft', key: 'Meta', metaKey: true }, 'down', firstActive)
    const metaThenAlt = toBrowserShortcutRecordEvent({
      code: 'AltLeft',
      key: 'Alt',
      altKey: true,
      metaKey: true,
    }, 'down', firstActive)
    const releaseMetaFirst = toBrowserShortcutRecordEvent({
      code: 'MetaLeft',
      key: 'Meta',
      altKey: true,
    }, 'up', firstActive)

    const secondActive = new Map()
    toBrowserShortcutRecordEvent({ code: 'AltLeft', key: 'Alt', altKey: true }, 'down', secondActive)
    const altThenMeta = toBrowserShortcutRecordEvent({
      code: 'MetaLeft',
      key: 'Meta',
      altKey: true,
      metaKey: true,
    }, 'down', secondActive)
    const releaseAltFirst = toBrowserShortcutRecordEvent({
      code: 'AltLeft',
      key: 'Alt',
      metaKey: true,
    }, 'up', secondActive)

    const expected = { source: 'keyboard', key: 'Meta', modifiers: ['Alt'] }
    expect(metaThenAlt?.chord).toEqual(expected)
    expect(altThenMeta?.chord).toEqual(expected)
    expect(releaseMetaFirst?.chord).toEqual(expected)
    expect(releaseAltFirst?.chord).toEqual(expected)
  })
})

describe('跨平台快捷键默认值', () => {
  it('macOS 保留 Fn 默认值，其他平台提供普通键盘默认值', () => {
    expect(MAC_DEFAULT_BINDINGS.recording?.chord.source).toBe('fn')
    expect(DEFAULT_KEYBOARD_BINDINGS.recording).toMatchObject({
      scope: 'global',
      chord: { source: 'keyboard', key: 'R', modifiers: ['Primary', 'Shift'] },
    })
    expect(DEFAULT_KEYBOARD_BINDINGS.screenshot?.chord.source).toBe('keyboard')
  })

  it('由 action activation 声明语音听写的 toggle 手势', () => {
    const action = SHORTCUT_ACTIONS.find(item => item.id === 'voiceDictation')!

    expect(action.activation).toBe('toggle')
    expect(MAC_DEFAULT_BINDINGS.voiceDictation?.gesture).toBe('press')
    expect(DEFAULT_KEYBOARD_BINDINGS.voiceDictation?.gesture).toBe('press')
    expect(getShortcutActionSupportedGestures(action)).toEqual(['press'])
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

/** 录制校验规则：判定顺序、放行清单与边界 */

import type { ShortcutBindings, ShortcutChord, ShortcutGestureBinding } from './types'
import { describe, expect, it } from 'vitest'
import { canShortcutChordDoublePress, validateShortcutRecording } from './validation'
import type { ShortcutRecordRule } from './validation-policy'

const OTHER_BINDINGS: ShortcutBindings = {
  self: null,
  other: press({ source: 'keyboard', key: 'R', modifiers: ['Meta', 'Shift'] }),
}

describe('快捷键校验', () => {
  it('超过 3 个键不通过', () => {
    expect(validate(press({ source: 'keyboard', key: 'R', modifiers: ['Control', 'Alt', 'Shift'] })))
      .toBe('tooManyKeys')
  })

  it('恰好 3 个键通过', () => {
    expect(validate(press({ source: 'keyboard', key: 'R', modifiers: ['Control', 'Alt'] })))
      .toBeNull()
  })

  it('Fn 组合把 fn 自己算进键数', () => {
    expect(validate(press({ source: 'fn', key: 'R', modifiers: ['Control', 'Alt'] })))
      .toBe('tooManyKeys')
  })

  it('fn + 修饰键按 fn 加修饰键计数，且不允许录成双击', () => {
    expect(validate(press({ source: 'fn', key: 'Fn', modifiers: ['Meta', 'Shift'] }))).toBeNull()
    expect(validate(press({ source: 'fn', key: 'Fn', modifiers: ['Control', 'Alt', 'Shift'] })))
      .toBe('tooManyKeys')
    expect(canShortcutChordDoublePress({ source: 'fn', key: 'Fn', modifiers: ['Meta'] })).toBe(false)
    expect(canShortcutChordDoublePress({ source: 'fn', key: 'Fn' })).toBe(true)
  })

  it('键数超限先于其他原因命中', () => {
    /** 这个组合同时撞了 `other` 的 ⇧⌘R，但键数这条排在前面 */
    expect(validate(press({ source: 'keyboard', key: 'R', modifiers: ['Meta', 'Shift', 'Control'] })))
      .toBe('tooManyKeys')
  })

  it('只有字母或数字不通过', () => {
    expect(validate(press({ source: 'keyboard', key: 'A', modifiers: [] }))).toBe('alphanumericOnly')
    expect(validate(press({ source: 'keyboard', key: '2', modifiers: [] }))).toBe('alphanumericOnly')
  })

  /** 模式的 `key` 要求主键与每个成员都命中，否则 `A + 2` 会与单独 `A` 无法区分 */
  it('多个字母数字一起按（A + 2）同样按「只有字母数字」拒绝', () => {
    expect(validate(press({ source: 'keyboard', key: 'A', modifiers: [], keys: ['2'] }))).toBe('alphanumericOnly')
  })

  /** 曾有一条兜底规则把这类组合全拒了，现在表里没写的组合一律放行 */
  it('多个普通键一起按住是一个 chord，只要不撞前四条就放行', () => {
    const systemShortcuts: ShortcutChord[] = [{ source: 'keyboard', key: 'Escape', modifiers: [] }]

    expect(validate(press({ source: 'keyboard', key: 'BracketLeft', modifiers: [], keys: ['BracketRight'] }))).toBeNull()
    expect(validate(press({ source: 'keyboard', key: 'A', modifiers: ['Meta'], keys: ['2'] }))).toBeNull()
    expect(validate(press({ source: 'fn', key: 'BracketLeft', modifiers: [], keys: ['BracketRight'] }))).toBeNull()
    /** 主键 Esc 是保留键，但 `Esc + A` 不是单独按下的 Esc */
    expect(validate(press({ source: 'keyboard', key: 'Escape', modifiers: [], keys: ['A'] }), OTHER_BINDINGS, systemShortcuts)).toBeNull()
    /** 成员与修饰键、fn 一样计入键数 */
    expect(validate(press({ source: 'keyboard', key: 'A', modifiers: ['Control', 'Alt'], keys: ['2'] }))).toBe('tooManyKeys')
    expect(validate(press({ source: 'fn', key: 'A', modifiers: ['Control'], keys: ['2'] }))).toBe('tooManyKeys')
  })

  it('⇧ 算修饰键，⇧ + 字母通过', () => {
    expect(validate(press({ source: 'keyboard', key: 'A', modifiers: ['Shift'] }))).toBeNull()
  })

  it('单独的标点通过', () => {
    expect(validate(press({ source: 'keyboard', key: 'Comma', modifiers: [] }))).toBeNull()
  })

  it('单独的方向键、单独的 F 键与方向键组合都放行', () => {
    expect(validate(press({ source: 'keyboard', key: 'ArrowUp', modifiers: [] }))).toBeNull()
    expect(validate(press({ source: 'keyboard', key: 'F5', modifiers: [] }))).toBeNull()
    expect(validate(press({ source: 'keyboard', key: 'ArrowLeft', modifiers: [], keys: ['ArrowUp'] }))).toBeNull()
    expect(validate(press({
      source: 'keyboard',
      key: 'ArrowLeft',
      modifiers: [],
      keys: ['ArrowUp', 'ArrowRight', 'ArrowDown'],
    }))).toBe('tooManyKeys')
  })

  it('与另一项当前快捷键相同不通过', () => {
    expect(validate(press({ source: 'keyboard', key: 'R', modifiers: ['Meta', 'Shift'] })))
      .toBe('alreadyInUse')
  })

  it('与本项当前快捷键相同视为通过', () => {
    const chord: ShortcutChord = { source: 'keyboard', key: 'Space', modifiers: [] }

    /** 裸 Space 本是系统保留键，但它已经是本项当前值，重录回自己必须放行 */
    expect(validate(press(chord), { ...OTHER_BINDINGS, self: press(chord) })).toBeNull()
  })

  it('单独按下即归系统所有的键不通过', () => {
    for (const key of ['Escape', 'Space', 'Tab', 'Backspace', 'Enter'] as const)
      expect(validate(press({ source: 'keyboard', key, modifiers: [] }))).toBe('systemReserved')
  })

  it('fn + F1–F19 由应用接管，不算系统保留', () => {
    expect(validate(press({ source: 'fn', key: 'F5', modifiers: [] }))).toBeNull()
  })

  it('fn + F 键即使出现在系统实时列表里也放行', () => {
    /** 用户改过的「显示桌面 fn + F11」会以 fn 掩码落进系统配置，这类组合录入后由应用接管 */
    const systemShortcuts: ShortcutChord[] = [{ source: 'fn', key: 'F11', modifiers: [] }]

    expect(validate(press({ source: 'fn', key: 'F11', modifiers: [] }), OTHER_BINDINGS, systemShortcuts)).toBeNull()
  })

  it('命中系统实时读取的快捷键不通过', () => {
    const systemShortcuts: ShortcutChord[] = [{ source: 'keyboard', key: 'Space', modifiers: ['Meta'] }]

    /** 录制拿到的是带侧别的物理修饰键，系统那边是逻辑修饰键，两者要能对上 */
    expect(validate(
      press({ source: 'keyboard', key: 'Space', modifiers: ['MetaLeft'] }),
      OTHER_BINDINGS,
      systemShortcuts,
    )).toBe('systemReserved')
  })
})

describe('声明式规则', () => {
  it('模式里的逻辑修饰键能匹配录制得到的物理侧别，且按数组顺序命中', () => {
    const rules: ShortcutRecordRule[] = [
      { code: 'first', kind: 'deny', patterns: [{ source: 'keyboard', key: 'Q', modifiers: ['Meta'] }] },
      { code: 'second', kind: 'deny', patterns: [{ key: 'Q' }] },
    ]

    /** 录制结果带侧别（`MetaLeft`），规则只写家族（`Meta`），两者要能对上，且先命中的规则胜出 */
    expect(validateShortcutRecording({
      binding: press({ source: 'keyboard', key: 'Q', modifiers: ['MetaLeft'] }),
      actionId: 'self',
      bindings: OTHER_BINDINGS,
      rules,
    })).toBe('first')

    expect(validateShortcutRecording({
      binding: press({ source: 'keyboard', key: 'Q', modifiers: ['ShiftLeft'] }),
      actionId: 'self',
      bindings: OTHER_BINDINGS,
      rules,
    })).toBe('second')
  })
})

function validate(
  binding: ShortcutGestureBinding,
  bindings: ShortcutBindings = OTHER_BINDINGS,
  systemShortcuts: ShortcutChord[] = [],
) {
  return validateShortcutRecording({ binding, actionId: 'self', bindings, systemShortcuts })
}

function press(chord: ShortcutChord) {
  return { gesture: 'press', chord, scope: 'global' } as const
}

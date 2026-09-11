/** 录制校验规则：判定顺序、放行清单与边界 */

import type { ShortcutBindings, ShortcutChord, ShortcutGestureBinding } from './types'
import { describe, expect, it } from 'vitest'
import { validateShortcutRecording } from './validation'
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

  it('键数超限先于其他原因命中', () => {
    /** 这个组合同时撞了 `other` 的 ⇧⌘R，但键数这条排在前面 */
    expect(validate(press({ source: 'keyboard', key: 'R', modifiers: ['Meta', 'Shift', 'Control'] })))
      .toBe('tooManyKeys')
  })

  it('只有字母或数字不通过', () => {
    expect(validate(press({ source: 'keyboard', key: 'A', modifiers: [] }))).toBe('alphanumericOnly')
    expect(validate(press({ source: 'keyboard', key: '2', modifiers: [] }))).toBe('alphanumericOnly')
  })

  /** 只看主键 chord 的话，`A + 2` 与单独 `A` 无法区分 */
  it('多个字母数字一起按（A + 2）同样按「只有字母数字」拒绝', () => {
    expect(validateShortcutRecording({
      binding: press({ source: 'keyboard', key: 'A', modifiers: [] }),
      extraKeys: ['2'],
      actionId: 'self',
      bindings: OTHER_BINDINGS,
    })).toBe('alphanumericOnly')
  })

  it('多主键组合前面规则没拦住的一律按「只能一个普通键」拒绝，键数超限仍优先', () => {
    const validateMulti = (chord: ShortcutChord, extraKeys: Array<'A' | '2'>) => validateShortcutRecording({
      binding: press(chord),
      extraKeys,
      actionId: 'self',
      bindings: { ...OTHER_BINDINGS, self: press({ source: 'keyboard', key: 'A', modifiers: ['Meta'] }) },
      systemShortcuts: [{ source: 'keyboard', key: 'Escape', modifiers: [] }],
    })

    /** 与本项当前值 ⌘A 主键相同也不能放行：chord 装不下 `2`，保存等于丢键 */
    expect(validateMulti({ source: 'keyboard', key: 'A', modifiers: ['Meta'] }, ['2'])).toBe('multipleKeys')
    /** 主键 Esc 是保留键，但额外的 A 不是，整个组合不算系统保留 */
    expect(validateMulti({ source: 'keyboard', key: 'Escape', modifiers: [] }, ['A'])).toBe('multipleKeys')
    expect(validateMulti({ source: 'keyboard', key: 'A', modifiers: ['Control', 'Alt'] }, ['2'])).toBe('tooManyKeys')
  })

  it('⇧ 算修饰键，⇧ + 字母通过', () => {
    expect(validate(press({ source: 'keyboard', key: 'A', modifiers: ['Shift'] }))).toBeNull()
  })

  it('单独的标点与方向键通过', () => {
    expect(validate(press({ source: 'keyboard', key: 'Comma', modifiers: [] }))).toBeNull()
    expect(validate(press({ source: 'keyboard', key: 'ArrowUp', modifiers: [] }))).toBeNull()
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
    for (const key of ['Escape', 'Space', 'Tab', 'Backspace', 'Enter', 'CapsLock', 'F5', 'F19'] as const)
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

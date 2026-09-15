/**
 * 快捷键录制校验引擎：按 `validation-policy.ts` 的规则顺序逐条判定，命中即返回，不再往下查
 *
 * 本模块只提供「录制结果 → 失败原因」这一个纯函数，不订阅输入、不改配置、不产出 UI；
 * 录制流程目前还没有接线到它，接入点在设置页拿到录制结果、写入配置之前
 */

import type { KeyboardInputKey, ShortcutBindings, ShortcutChord, ShortcutGestureBinding } from './types'
import { shortcutBindingsConflict, shortcutChordsEqual, shortcutModifiersEqual } from './utils'
import type { ShortcutChordPattern, ShortcutRecordRule, ShortcutValidationCode } from './validation-policy'
import { SHORTCUT_DOUBLE_PRESS_CHORDS, SHORTCUT_RECORD_RULES } from './validation-policy'

/**
 * 校验一次录制结果
 *
 * `systemShortcuts` 由主进程实时读取当前系统已启用的快捷键；读取失败或平台不支持
 * 时传空数组，此时只剩下策略里写死的静态模式
 *
 * @returns 命中的失败原因；`null` 表示通过
 */
export function validateShortcutRecording(
  options: ValidateShortcutRecordingOptions,
): ShortcutValidationCode | null {
  const { binding, actionId, bindings, systemShortcuts = [], rules = SHORTCUT_RECORD_RULES } = options

  /** 与本项当前快捷键相同视为通过：否则规则变严后用户连自己已有的值都重录不回来 */
  const current = bindings[actionId]
  if (current && shortcutBindingsConflict(binding, current))
    return null

  const context: RuleContext = { binding, actionId, bindings, systemShortcuts }
  const hit = rules.find(rule => isRuleHit(rule, context))

  return hit
    ? hit.code as ShortcutValidationCode
    : null
}

/** 该 chord 能不能录成双击，由策略里的 {@link SHORTCUT_DOUBLE_PRESS_CHORDS} 决定 */
export function canShortcutChordDoublePress(chord: ShortcutChord): boolean {
  return matchesAnyShortcutChordPattern(chord, SHORTCUT_DOUBLE_PRESS_CHORDS)
}

/**
 * 统计 chord 的按键数量
 *
 * 纯修饰键 chord 的主键本身就是修饰键之一，与普通组合同样按「主键 + 修饰键」计数，
 * 一起按住的普通键成员（`[ + ]`）各算一个；Fn 组合额外加上 fn 自己，裸 fn 只算一个键，
 * `fn + ⌘` 这类 Fn 修饰键 chord 按 fn 加修饰键数计
 */
export function countShortcutChordKeys(chord: ShortcutChord): number {
  const memberCount = chord.keys?.length ?? 0

  if (chord.source === 'fn') {
    const modifierCount = chord.modifiers?.length ?? 0

    return chord.key === 'Fn'
      ? 1 + modifierCount
      : 2 + modifierCount + memberCount
  }

  return 1 + chord.modifiers.length + memberCount
}

/** chord 是否命中模式；模式里省略的字段不参与比较 */
export function matchesShortcutChordPattern(chord: ShortcutChord, pattern: ShortcutChordPattern): boolean {
  if (pattern.source && chord.source !== pattern.source)
    return false

  if (pattern.key !== undefined) {
    const allowed: readonly KeyboardInputKey[] = typeof pattern.key === 'string'
      ? [pattern.key]
      : pattern.key
    /** 主键与每个成员都要命中：`A + 2` 才算「只有字母数字」，`Esc + A` 不算单独的 Esc */
    const members: KeyboardInputKey[] = [chord.key, ...(chord.keys ?? [])]
    if (!members.every(key => allowed.includes(key)))
      return false
  }

  if (pattern.keys === 'none' && chord.keys?.length)
    return false

  const modifiers = chord.modifiers ?? []
  const constraint = pattern.modifiers ?? 'any'
  if (constraint === 'any')
    return true
  if (constraint === 'none')
    return modifiers.length === 0

  return shortcutModifiersEqual(modifiers, constraint)
}

export function matchesAnyShortcutChordPattern(
  chord: ShortcutChord,
  patterns: readonly ShortcutChordPattern[],
): boolean {
  return patterns.some(pattern => matchesShortcutChordPattern(chord, pattern))
}

function isRuleHit(rule: ShortcutRecordRule, context: RuleContext): boolean {
  const { binding, actionId, bindings, systemShortcuts } = context
  const { chord } = binding

  switch (rule.kind) {
    case 'maxKeys':
      return countShortcutChordKeys(chord) > rule.max

    case 'inUse':
      return Object.entries(bindings).some(([id, existing]) => (
        id !== actionId
        && !!existing
        && shortcutBindingsConflict(binding, existing)
      ))

    case 'deny': {
      if (rule.except && matchesAnyShortcutChordPattern(chord, rule.except))
        return false
      if (rule.patterns && matchesAnyShortcutChordPattern(chord, rule.patterns))
        return true

      return !!rule.systemShortcuts
        && systemShortcuts.some(reserved => shortcutChordsEqual(chord, reserved))
    }
  }
}

type RuleContext = Required<Pick<ValidateShortcutRecordingOptions, 'binding' | 'actionId' | 'bindings' | 'systemShortcuts'>>

export type ValidateShortcutRecordingOptions = {
  /** 本轮录制结果 */
  binding: ShortcutGestureBinding
  /** 正在设置的 action id */
  actionId: string
  /** 全部 action 的当前绑定 */
  bindings: ShortcutBindings
  /**
   * 系统当前已启用的快捷键
   * @default []
   */
  systemShortcuts?: readonly ShortcutChord[]
  /**
   * 判定规则，按顺序逐条检查
   * @default SHORTCUT_RECORD_RULES
   */
  rules?: readonly ShortcutRecordRule[]
}

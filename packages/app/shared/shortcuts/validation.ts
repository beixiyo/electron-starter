/**
 * 快捷键录制校验引擎：按 `validation-policy.ts` 的规则顺序逐条判定，命中即返回，不再往下查
 *
 * 本模块只提供「录制结果 → 失败原因」这一个纯函数，不订阅输入、不改配置、不产出 UI；
 * 录制流程目前还没有接线到它，接入点在设置页拿到录制结果、写入配置之前
 */

import type { KeyboardCode, ShortcutBindings, ShortcutChord, ShortcutGestureBinding } from './types'
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
  const { binding, actionId, bindings, systemShortcuts = [], extraKeys = [], rules = SHORTCUT_RECORD_RULES } = options

  /** 与本项当前快捷键相同视为通过：否则规则变严后用户连自己已有的值都重录不回来 */
  const current = bindings[actionId]
  if (!extraKeys.length && current && shortcutBindingsConflict(binding, current))
    return null

  const context: RuleContext = { binding, actionId, bindings, systemShortcuts, extraKeys }
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
 * 纯修饰键 chord 的主键本身就是修饰键之一，与普通组合同样按「主键 + 修饰键」计数；
 * Fn 组合额外加上 fn 自己，裸 fn 只算一个键
 */
export function countShortcutChordKeys(chord: ShortcutChord): number {
  if (chord.source === 'fn') {
    return chord.key === 'Fn'
      ? 1
      : 2 + (chord.modifiers?.length ?? 0)
  }

  return 1 + chord.modifiers.length
}

/** chord 是否命中模式；模式里省略的字段不参与比较 */
export function matchesShortcutChordPattern(chord: ShortcutChord, pattern: ShortcutChordPattern): boolean {
  if (pattern.source && chord.source !== pattern.source)
    return false

  if (pattern.key !== undefined) {
    const keys = typeof pattern.key === 'string'
      ? [pattern.key]
      : pattern.key
    if (!keys.includes(chord.key))
      return false
  }

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
  const { binding, actionId, bindings, systemShortcuts, extraKeys } = context
  const { chord } = binding
  const isMultiKey = extraKeys.length > 0

  switch (rule.kind) {
    case 'maxKeys':
      return countShortcutChordKeys(chord) + extraKeys.length > rule.max

    case 'inUse':
      return !isMultiKey && Object.entries(bindings).some(([id, existing]) => (
        id !== actionId
        && !!existing
        && shortcutBindingsConflict(binding, existing)
      ))

    case 'deny': {
      if (rule.except && matchesAnyShortcutChordPattern(chord, rule.except))
        return false
      if (rule.patterns && matchesAnyPatternWithExtraKeys(chord, extraKeys, rule.patterns))
        return true

      return !isMultiKey
        && !!rule.systemShortcuts
        && systemShortcuts.some(reserved => shortcutChordsEqual(chord, reserved))
    }

    case 'singleKey':
      return isMultiKey
  }
}

/**
 * 多主键组合要求主键与每个额外键命中同一条模式
 *
 * 额外键按「无修饰键的普通键」参与匹配：它们是在主键之后才按下的，修饰键状态已冻结在主键 chord 里
 */
function matchesAnyPatternWithExtraKeys(
  chord: ShortcutChord,
  extraKeys: readonly KeyboardCode[],
  patterns: readonly ShortcutChordPattern[],
): boolean {
  return patterns.some(pattern => (
    matchesShortcutChordPattern(chord, pattern)
    && extraKeys.every(key => matchesShortcutChordPattern({ source: 'keyboard', key, modifiers: [] }, pattern))
  ))
}

type RuleContext = Required<Pick<ValidateShortcutRecordingOptions, 'binding' | 'actionId' | 'bindings' | 'systemShortcuts' | 'extraKeys'>>

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
   * 主键按住期间又按下的其他普通键；录制流程接线后由录制结果提供
   * @default []
   */
  extraKeys?: readonly KeyboardCode[]
  /**
   * 判定规则，按顺序逐条检查
   * @default SHORTCUT_RECORD_RULES
   */
  rules?: readonly ShortcutRecordRule[]
}

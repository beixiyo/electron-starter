import type { FnModifier, KeyboardCode, KeyboardModifierCode, KeyboardShortcutModifier, ShortcutChord, ShortcutGestureBinding } from '@shared/shortcuts'
import { isKeyboardModifierCode, KEYBOARD_MODIFIER_BY_CODE, normalizeShortcutModifier } from '@shared/shortcuts'
import { isApplePlatform } from 'utils/keyboard'

/** 将快捷键绑定转换成稳定、可读的显示文本。 */
export function formatBinding(
  binding: ShortcutGestureBinding,
  options: FormatBindingOptions = {},
): string {
  const { separator = SHORTCUT_KEY_SEPARATOR, extraKeys = [] } = options
  const chord = [formatChord(binding.chord, separator), ...extraKeys.map(formatKey)].join(separator)

  switch (binding.gesture) {
    case 'press':
      return chord
    case 'doublePress':
      return [chord, chord].join(separator)
    case 'hold':
      return `Hold ${chord}`
  }
}

/** 修饰键、主键和同组按键之间的默认连接符。 */
export const SHORTCUT_KEY_SEPARATOR = ' + '

function formatChord(chord: ShortcutChord, separator: string): string {
  if (chord.source === 'fn') {
    return [
      'fn',
      ...formatModifierFamilies(chord.modifiers ?? []),
      ...(chord.key === 'Fn'
        ? []
        : [formatKey(chord.key)]),
    ].join(separator)
  }

  if (isKeyboardModifierCode(chord.key)) return formatModifierFamilies([chord.key, ...chord.modifiers]).join(separator)

  return [
    ...formatModifierFamilies(chord.modifiers),
    formatKey(chord.key),
    ...(chord.keys ?? []).map(formatKey),
  ].join(separator)
}

/** 按 Control、Alt、Shift、Meta 家族排序，同时保留左右物理侧别。 */
function formatModifierFamilies(modifiers: readonly KeyboardShortcutModifier[]): string[] {
  const entries = new Map<string, ModifierEntry>()

  for (const modifier of modifiers) {
    const entry: ModifierEntry = isKeyboardModifierCode(modifier)
      ? { family: KEYBOARD_MODIFIER_BY_CODE[modifier]!, side: modifierSideOf(modifier) }
      : { family: normalizeShortcutModifier(modifier), side: null }

    entries.set(`${entry.family}:${entry.side ?? ''}`, entry)
  }

  return Array.from(entries.values())
    .sort((a, b) => (
      MODIFIER_DISPLAY_ORDER.indexOf(a.family) - MODIFIER_DISPLAY_ORDER.indexOf(b.family)
      || SIDE_DISPLAY_ORDER.indexOf(a.side) - SIDE_DISPLAY_ORDER.indexOf(b.side)
    ))
    .map(({ family, side }) =>
      side
        ? `${side} ${MODIFIER_DISPLAY[family]}`
        : MODIFIER_DISPLAY[family]
    )
}

function modifierSideOf(modifier: KeyboardModifierCode): ModifierSide {
  return modifier.endsWith('Left')
    ? 'Left'
    : 'Right'
}

function formatKey(key: string): string {
  return KEY_DISPLAY[key] ?? key
}

const MODIFIER_DISPLAY_ORDER: readonly FnModifier[] = ['Control', 'Alt', 'Shift', 'Meta']
const SIDE_DISPLAY_ORDER: readonly (ModifierSide | null)[] = [null, 'Left', 'Right']
const MODIFIER_DISPLAY: Readonly<Record<FnModifier, string>> = isApplePlatform()
  ? { Control: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
  : { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' }

/** 特殊键显示名称保留足够的文字，避免单个符号难以辨认。 */
const KEY_DISPLAY: Record<string, string> = {
  Space: 'Space',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: '\'',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Enter: 'Enter ↩',
  Escape: 'Esc',
  Backspace: 'Delete ⌫',
  Tab: 'Tab ⇥',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Delete: 'Delete ⌦',
  ArrowLeft: 'Left ←',
  ArrowRight: 'Right →',
  ArrowUp: 'Up ↑',
  ArrowDown: 'Down ↓',
}

export type FormatBindingOptions = {
  /** 修饰键与主键之间的连接符。 @default SHORTCUT_KEY_SEPARATOR */
  separator?: string
  /** 主键之后一起按下的普通键，用于失败录制的完整回显。 @default [] */
  extraKeys?: readonly KeyboardCode[]
}

type ModifierSide = 'Left' | 'Right'

type ModifierEntry = {
  family: FnModifier
  side: ModifierSide | null
}

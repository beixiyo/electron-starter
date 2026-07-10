import type {
  ShortcutBinding,
  ShortcutChord,
  ShortcutGestureBinding,
  ShortcutGestureType,
  ShortcutModifier,
  ShortcutScope,
} from '@shared/shortcuts'
import { SHORTCUT_ACTIONS, shortcutBindingsConflict } from '@shared/shortcuts'

export type { ShortcutBinding }
export type { FnComboKey, ShortcutGestureBinding, ShortcutScope } from '@shared/shortcuts'

/** 设置页可录制的手势类型 */
export type GestureType = ShortcutGestureType

/** 设置页展示的快捷键 action */
export type ShortcutAction = {
  /** action id */
  id: string
  /** 展示名称 */
  label: string
  /** 当前绑定，null 表示禁用 */
  binding: ShortcutBinding | null
  /** 该 action 允许录制的手势类型 */
  supportedGestures: GestureType[]
}

const FN_KEY_DISPLAY: Record<string, string> = {
  Space: 'Space',
  Grave: '`',
  Minus: '-',
  Equal: '=',
  LeftBracket: '[',
  RightBracket: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: '\'',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Enter: 'Return',
  Escape: 'Esc',
  Backspace: '⌫',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Delete: 'Del',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
}

const MOD_SYMBOL: Record<ShortcutModifier, string> = {
  Meta: '⌘',
  Primary: '⌘/Ctrl',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
}

const HOTKEY_DISPLAY: Record<string, string> = {
  Space: '␣',
  Enter: '↩',
  Escape: '⎋',
  Backspace: '⌫',
  Delete: '⌦',
  Tab: '⇥',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
}

export function formatBinding(binding: ShortcutGestureBinding): string {
  const chord = formatChord(binding.chord)

  switch (binding.gesture) {
    case 'press':
      return chord
    case 'doublePress':
      return `Double ${chord}`
    case 'hold':
      return `Hold ${chord}`
  }
}

export function getScopeLabel(scope: ShortcutScope): string {
  return scope === 'global'
    ? '全局'
    : '窗口内'
}

export function bindingsConflict(a: ShortcutBinding, b: ShortcutBinding): boolean {
  return shortcutBindingsConflict(a, b)
}

function formatChord(chord: ShortcutChord): string {
  if (chord.source === 'fn') {
    if (chord.key === 'Fn')
      return 'fn'
    const mods = (chord.modifiers ?? []).map(m => MOD_SYMBOL[m]).join('')
    return `fn + ${mods}${FN_KEY_DISPLAY[chord.key] ?? chord.key}`
  }

  const mods = chord.modifiers.map(m => MOD_SYMBOL[m]).join('')
  const key = HOTKEY_DISPLAY[chord.key] ?? chord.key
  return `${mods}${key}`
}

export const DEFAULT_ACTIONS: ShortcutAction[] = SHORTCUT_ACTIONS.map(action => ({
  id: action.id,
  label: action.label,
  binding: action.binding,
  supportedGestures: [...action.supportedGestures],
}))

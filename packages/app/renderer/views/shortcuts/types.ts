import type {
  FnModifier,
  ShortcutBinding,
  ShortcutChord,
  ShortcutGestureBinding,
  ShortcutGestureType,
  ShortcutModifier,
} from '@shared/shortcuts'
import {
  getShortcutActionSupportedGestures,
  normalizeShortcutModifier,
  SHORTCUT_ACTIONS,
  shortcutBindingsConflict,
  toShortcutActionBinding,
} from '@shared/shortcuts'

export type { ShortcutBinding }
export type { FnComboKey, ShortcutGestureBinding } from '@shared/shortcuts'

/** 设置页可录制的手势类型 */
export type GestureType = ShortcutGestureType

/** 设置页展示的快捷键 action */
export type ShortcutAction = {
  /** action id */
  id: string
  /** 展示名称 */
  label: string
  /** action 声明的生效范围，录制时不可由 UI 覆盖 */
  scope: ShortcutBinding['scope']
  /** action 的触发语义 */
  activation: 'trigger' | 'hold' | 'toggle'
  /** 当前绑定，null 表示禁用 */
  binding: ShortcutBinding | null
  /** 该 action 允许录制的手势类型 */
  supportedGestures: GestureType[]
  /** 该 action 允许录制的按键形态 */
  recordingChord: Readonly<Record<'fn' | 'keyboard', 'single' | 'combination'>>
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

const IS_APPLE_PLATFORM = detectApplePlatform()
const MODIFIER_DISPLAY: Record<FnModifier, string> = IS_APPLE_PLATFORM
  ? { Meta: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' }
  : { Meta: 'Win', Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift' }
const MODIFIER_SEPARATOR = IS_APPLE_PLATFORM
  ? ''
  : ' + '

const KEYBOARD_MODIFIER_DISPLAY: Record<string, string> = {
  Meta: MODIFIER_DISPLAY.Meta,
  Control: MODIFIER_DISPLAY.Control,
  Alt: MODIFIER_DISPLAY.Alt,
  Shift: MODIFIER_DISPLAY.Shift,
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

export function bindingsConflict(a: ShortcutBinding, b: ShortcutBinding): boolean {
  return shortcutBindingsConflict(a, b)
}

function formatChord(chord: ShortcutChord): string {
  if (chord.source === 'fn') {
    if (chord.key === 'Fn')
      return 'fn'
    const modifiers = formatModifiers(chord.modifiers ?? [])
    const key = FN_KEY_DISPLAY[chord.key] ?? chord.key
    return modifiers
      ? `fn + ${modifiers}${IS_APPLE_PLATFORM
        ? ''
        : ' + '}${key}`
      : `fn + ${key}`
  }

  const modifiers = formatModifiers(chord.modifiers)
  const key = KEYBOARD_MODIFIER_DISPLAY[chord.key] ?? HOTKEY_DISPLAY[chord.key] ?? chord.key
  return `${modifiers}${modifiers && !IS_APPLE_PLATFORM
    ? ' + '
    : ''}${key}`
}

function formatModifiers(modifiers: ShortcutModifier[]): string {
  return modifiers
    .map(modifier => MODIFIER_DISPLAY[normalizeShortcutModifier(modifier)])
    .join(MODIFIER_SEPARATOR)
}

function detectApplePlatform(): boolean {
  const maybeProcess = globalThis as typeof globalThis & { process?: { platform?: string } }
  if (maybeProcess.process?.platform)
    return maybeProcess.process.platform === 'darwin'

  const maybeNavigator = globalThis as typeof globalThis & { navigator?: { platform?: string, userAgent?: string } }
  const platform = maybeNavigator.navigator?.platform ?? ''
  const userAgent = maybeNavigator.navigator?.userAgent ?? ''
  return /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS X/i.test(userAgent)
}

export const DEFAULT_ACTIONS: ShortcutAction[] = SHORTCUT_ACTIONS.map(action => ({
  id: action.id,
  label: action.label,
  scope: action.scope,
  activation: action.activation,
  binding: toShortcutActionBinding(action, action.binding),
  supportedGestures: [...getShortcutActionSupportedGestures(action)],
  recordingChord: action.recordingChord,
}))

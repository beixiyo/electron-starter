import type { Modifier, ShortcutBinding, ShortcutChord, ShortcutGestureType } from '@ipc/services/shortcut-config/contract'
import { DEFAULT_BINDINGS, shortcutChordsEqual } from '@ipc/services/shortcut-config/contract'

export type { Modifier, ShortcutBinding }
export type { FnComboKey } from '@ipc/services/fn/contract'

export type GestureType = ShortcutGestureType

export type ShortcutAction = {
  id: string
  label: string
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

const MOD_SYMBOL: Record<Modifier, string> = {
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

export function formatBinding(binding: ShortcutBinding): string {
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
  if (!shortcutChordsEqual(a.chord, b.chord))
    return false

  if (a.chord.source === 'fn' && b.chord.source === 'fn' && a.chord.key === 'Fn') {
    return a.gesture === b.gesture
  }

  return true
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

export const DEFAULT_ACTIONS: ShortcutAction[] = [
  {
    id: 'recording',
    label: '录音',
    binding: DEFAULT_BINDINGS.recording,
    supportedGestures: ['press', 'doublePress'],
  },
  {
    id: 'askAssistant',
    label: 'Ask',
    binding: DEFAULT_BINDINGS.askAssistant,
    supportedGestures: ['doublePress', 'press'],
  },
  {
    id: 'voiceDictation',
    label: '语音听写',
    binding: DEFAULT_BINDINGS.voiceDictation,
    supportedGestures: ['hold'],
  },
  {
    id: 'bookmark',
    label: '标记',
    binding: DEFAULT_BINDINGS.bookmark,
    supportedGestures: ['press', 'doublePress'],
  },
]

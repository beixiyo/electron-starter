import type { Modifier, ShortcutBinding } from '@ipc/services/shortcut-config/contract'
import { DEFAULT_BINDINGS } from '@ipc/services/shortcut-config/contract'

export type { Modifier, ShortcutBinding }
export type { FnComboKey } from '@ipc/services/fn/contract'

export type GestureType = 'hold' | 'doublePress' | 'combo' | 'hotkey'

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
  switch (binding.type) {
    case 'combo': {
      const mods = (binding.modifiers ?? []).map(m => MOD_SYMBOL[m]).join('')
      return `fn + ${mods}${FN_KEY_DISPLAY[binding.key] ?? binding.key}`
    }
    case 'doublePress':
      return 'Double fn'
    case 'hold':
      return 'Hold fn'
    case 'hotkey': {
      const mods = binding.modifiers.map(m => MOD_SYMBOL[m]).join('')
      const key = HOTKEY_DISPLAY[binding.key] ?? binding.key
      return `${mods}${key}`
    }
  }
}

export const DEFAULT_ACTIONS: ShortcutAction[] = [
  {
    id: 'recording',
    label: '录音',
    binding: DEFAULT_BINDINGS.recording,
    supportedGestures: ['combo', 'doublePress', 'hotkey'],
  },
  {
    id: 'askAssistant',
    label: 'Ask',
    binding: DEFAULT_BINDINGS.askAssistant,
    supportedGestures: ['doublePress', 'combo', 'hotkey'],
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
    supportedGestures: ['combo', 'doublePress', 'hotkey'],
  },
]

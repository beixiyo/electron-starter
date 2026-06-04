import type { FnComboKey } from '@ipc/services/fn/contract'

export type { FnComboKey }

export type ShortcutBinding
  = | { type: 'combo', key: FnComboKey }
    | { type: 'doublePress' }
    | { type: 'hold' }

export type ShortcutAction = {
  id: string
  label: string
  binding: ShortcutBinding | null
}

const KEY_DISPLAY: Record<string, string> = {
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

export function formatBinding(binding: ShortcutBinding): string {
  switch (binding.type) {
    case 'combo': {
      const display = KEY_DISPLAY[binding.key] ?? binding.key
      return `fn + ${display}`
    }
    case 'doublePress':
      return 'Double fn'
    case 'hold':
      return 'Hold fn'
  }
}

export const DEFAULT_ACTIONS: ShortcutAction[] = [
  { id: 'recording', label: '录音', binding: { type: 'combo', key: 'Space' } },
  { id: 'askFlowtica', label: 'Ask Flowtica', binding: { type: 'doublePress' } },
  { id: 'voiceDictation', label: '语音听写', binding: { type: 'hold' } },
  { id: 'bookmark', label: '标记', binding: { type: 'combo', key: 'Grave' } },
]

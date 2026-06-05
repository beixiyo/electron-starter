import type { IpcContract } from '@ipc/core'

/** Fn 组合键触发时可能附带的修饰符 */
export type Modifier = 'Meta' | 'Control' | 'Alt' | 'Shift'

/** 与 fn-listener.swift COMBO_KEYS 保持一一对应 */
export type FnComboKey
  = | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
    | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z'
    | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
    | 'Enter' | 'Escape' | 'Backspace' | 'Tab' | 'Space'
    | 'Minus' | 'Equal' | 'LeftBracket' | 'RightBracket' | 'Backslash'
    | 'Semicolon' | 'Quote' | 'Grave' | 'Comma' | 'Period' | 'Slash'
    | 'Home' | 'End' | 'PageUp' | 'PageDown' | 'Delete'
    | 'Left' | 'Right' | 'Up' | 'Down'
    | 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6'
    | 'F7' | 'F8' | 'F9' | 'F10' | 'F11' | 'F12'

export type FnContract = IpcContract<{}, {
  down: undefined
  up: undefined
  doublePress: undefined
  combo: { key: FnComboKey, modifiers: Modifier[] }
}>

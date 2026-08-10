import type { KeyboardCode, KeyboardShortcutChord, ShortcutModifier, ShortcutRecordEvent } from './types'
import { normalizeKeyboardCode, normalizeKeyboardShortcutChord, releaseActiveKeyboardChord } from './utils'

const BROWSER_LOCK_KEYS = new Set([
  'CapsLock',
  'NumLock',
  'ScrollLock',
])

export function toBrowserShortcutRecordEvent(
  event: BrowserShortcutKeyEvent,
  phase: BrowserShortcutRecordPhase,
  activeChords: Map<string, KeyboardShortcutChord>,
): ShortcutRecordEvent | null {
  const keyId = getBrowserShortcutKeyId(event)

  if (phase === 'up') {
    const chord = releaseActiveKeyboardChord(activeChords, keyId)
    if (!chord)
      return null

    return {
      phase,
      chord,
      timestamp: Date.now(),
    }
  }

  if (event.repeat || activeChords.has(keyId) || BROWSER_LOCK_KEYS.has(event.key))
    return null

  const chord = toBrowserShortcutChord(event)
  if (!chord)
    return null

  activeChords.set(keyId, chord)
  return {
    phase,
    chord,
    timestamp: Date.now(),
  }
}

export function toBrowserShortcutChord(event: BrowserShortcutKeyEvent): KeyboardShortcutChord | null {
  const key = normalizeBrowserShortcutKey(event)
  if (!key)
    return null

  return normalizeKeyboardShortcutChord(key, getBrowserShortcutModifiers(event))
}

export function normalizeBrowserShortcutKey(event: BrowserShortcutKeyEvent): KeyboardCode | null {
  const { code, key } = event

  if (code.startsWith('Key'))
    return normalizeKeyboardCode(code.slice(3).toUpperCase())
  if (code.startsWith('Digit'))
    return normalizeKeyboardCode(code.slice(5))
  if (code)
    return normalizeKeyboardCode(code)
  if (key && !BROWSER_LOCK_KEYS.has(key)) {
    return normalizeKeyboardCode(key.length === 1
      ? key.toUpperCase()
      : key)
  }

  return null
}

export function getBrowserShortcutModifiers(event: BrowserShortcutKeyEvent): ShortcutModifier[] {
  const modifiers: ShortcutModifier[] = []

  if (event.metaKey)
    modifiers.push('Meta')
  if (event.ctrlKey)
    modifiers.push('Control')
  if (event.altKey)
    modifiers.push('Alt')
  if (event.shiftKey)
    modifiers.push('Shift')

  return modifiers
}

export function getBrowserShortcutKeyId(event: BrowserShortcutKeyEvent): string {
  return event.code || event.key || 'Unidentified'
}

/** 浏览器 KeyboardEvent 的快捷键归一化所需字段子集 */
export type BrowserShortcutKeyEvent = {
  code: string
  key: string
  repeat?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

type BrowserShortcutRecordPhase = Extract<ShortcutRecordEvent['phase'], 'down' | 'up'>

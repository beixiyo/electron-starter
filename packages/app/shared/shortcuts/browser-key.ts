import type { KeyboardShortcutChord, ShortcutModifier, ShortcutRecordEvent } from './types'

export const BROWSER_MODIFIER_KEYS = new Set([
  'Alt',
  'CapsLock',
  'Control',
  'Meta',
  'NumLock',
  'ScrollLock',
  'Shift',
])

export function toBrowserShortcutRecordEvent(
  event: BrowserShortcutKeyEvent,
  phase: BrowserShortcutRecordPhase,
  activeChords: Map<string, KeyboardShortcutChord>,
): ShortcutRecordEvent | null {
  const keyId = getBrowserShortcutKeyId(event)

  if (phase === 'up') {
    const chord = activeChords.get(keyId)
    if (!chord)
      return null

    activeChords.delete(keyId)
    return {
      phase,
      chord,
      timestamp: Date.now(),
    }
  }

  if (event.repeat || activeChords.has(keyId) || isBrowserModifierOnlyEvent(event))
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

  return {
    source: 'keyboard',
    key,
    modifiers: getBrowserShortcutModifiers(event),
  }
}

export function normalizeBrowserShortcutKey(event: BrowserShortcutKeyEvent): string | null {
  const { code, key } = event

  if (code.startsWith('Key'))
    return code.slice(3).toUpperCase()
  if (code.startsWith('Digit'))
    return code.slice(5)
  if (code)
    return code
  if (key && !BROWSER_MODIFIER_KEYS.has(key)) {
    return key.length === 1
      ? key.toUpperCase()
      : key
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

export function isBrowserModifierOnlyEvent(event: BrowserShortcutKeyEvent): boolean {
  return BROWSER_MODIFIER_KEYS.has(event.key) || BROWSER_MODIFIER_KEYS.has(event.code)
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

import type {
  ActiveKeyboardShortcutEntry,
  KeyboardCode,
  KeyboardShortcutChord,
  KeyboardShortcutModifier,
  ShortcutModifier,
  ShortcutRecordEvent,
} from './types'
import {
  normalizeKeyboardCode,
  normalizeKeyboardShortcutChord,
  pressKeyboardShortcutChord,
  releaseActiveKeyboardChords,
  specializeKeyboardShortcutModifiers,
} from './utils'

const BROWSER_LOCK_KEYS = new Set([
  'CapsLock',
  'NumLock',
  'ScrollLock',
])

/** 将一次 DOM 按键相位转换为标准事件；成员释放时可能结束多个冻结 chord */
export function toBrowserShortcutRecordEvents(
  event: BrowserShortcutKeyEvent,
  phase: BrowserShortcutRecordPhase,
  activeEntries: Map<string, ActiveKeyboardShortcutEntry>,
): ShortcutRecordEvent[] {
  const keyId = getBrowserShortcutKeyId(event)
  const timestamp = Date.now()

  if (phase === 'up') {
    return releaseActiveKeyboardChords(
      activeEntries,
      keyId,
      getBrowserLogicalShortcutModifiers(event),
    ).map(chord => ({
      phase,
      chord,
      timestamp,
    }))
  }

  if (event.repeat || activeEntries.has(keyId) || BROWSER_LOCK_KEYS.has(event.key))
    return []

  const key = normalizeBrowserShortcutKey(event)
  if (!key)
    return []

  const chord = pressKeyboardShortcutChord(
    activeEntries,
    keyId,
    key,
    getBrowserLogicalShortcutModifiers(event),
  )
  return [{
    phase,
    chord,
    timestamp,
  }]
}

export function toBrowserShortcutChord(
  event: BrowserShortcutKeyEvent,
  activeEntries: Iterable<ActiveKeyboardShortcutEntry> = [],
): KeyboardShortcutChord | null {
  const key = normalizeBrowserShortcutKey(event)
  if (!key)
    return null

  return normalizeKeyboardShortcutChord(key, getBrowserShortcutModifiers(event, activeEntries))
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

export function getBrowserShortcutModifiers(
  event: BrowserShortcutKeyEvent,
  activeEntries: Iterable<ActiveKeyboardShortcutEntry> = [],
): KeyboardShortcutModifier[] {
  return specializeKeyboardShortcutModifiers(
    getBrowserLogicalShortcutModifiers(event),
    activeEntries,
  )
}

/** 读取 DOM 事件的逻辑 modifier flags，不推断左右物理侧 */
export function getBrowserLogicalShortcutModifiers(
  event: BrowserShortcutKeyEvent,
): ShortcutModifier[] {
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

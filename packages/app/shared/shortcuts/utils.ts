import type {
  FnModifier,
  FnShortcutKey,
  KeyboardShortcutChord,
  ShortcutBinding,
  ShortcutBindings,
  ShortcutChord,
  ShortcutGestureType,
  ShortcutModifier,
  ShortcutScope,
} from './types'
import { FN_SHORTCUT_KEYS, SHORTCUT_GESTURES } from './types'

export function shortcutChordsEqual(a: ShortcutChord, b: ShortcutChord): boolean {
  return a.source === b.source
    && a.key === b.key
    && shortcutModifiersEqual(a.modifiers ?? [], b.modifiers ?? [])
}

export function shortcutModifiersEqual(a: ShortcutModifier[], b: ShortcutModifier[]): boolean {
  const left = normalizeShortcutModifiers(a)
  const right = normalizeShortcutModifiers(b)

  return left.length === right.length
    && left.every((modifier, index) => modifier === right[index])
}

/** 把外部 JSON 数据归一成当前 ShortcutBinding 结构 */
export function normalizeShortcutBindings(bindings: unknown): ShortcutBindings {
  if (!isRecord(bindings))
    return {}

  return Object.fromEntries(
    Object.entries(bindings).map(([id, binding]) => [id, normalizeShortcutBinding(binding)]),
  )
}

/** 把单个 binding 补齐到当前结构；外部 JSON 缺 scope 时默认按桌面全局快捷键处理 */
export function normalizeShortcutBinding(binding: unknown): ShortcutBinding | null {
  if (!binding)
    return null
  if (!isRecord(binding))
    return null

  const gesture = normalizeShortcutGesture(binding.gesture)
  const chord = normalizeShortcutChord(binding.chord)
  if (!gesture || !chord)
    return null

  const normalized: ShortcutBinding = {
    scope: normalizeShortcutScope(binding.scope),
    gesture,
    chord,
  }

  const intervalMs = normalizePositiveNumber(binding.intervalMs)
  if (intervalMs !== undefined)
    normalized.intervalMs = intervalMs

  const minDurationMs = normalizePositiveNumber(binding.minDurationMs)
  if (minDurationMs !== undefined)
    normalized.minDurationMs = minDurationMs

  return normalized
}

/** 判断两个 binding 是否会在运行时互相抢占 */
export function shortcutBindingsConflict(a: ShortcutBinding, b: ShortcutBinding): boolean {
  if (!shortcutChordsEqual(a.chord, b.chord))
    return false

  if (a.chord.source === 'fn' && b.chord.source === 'fn' && a.chord.key === 'Fn') {
    return a.gesture === b.gesture
  }

  return true
}

/** 收敛冲突 binding；同一批写入中后出现的 binding 优先 */
export function resolveShortcutBindingConflicts(bindings: ShortcutBindings): ShortcutBindings {
  const next: ShortcutBindings = {}

  for (const [id, binding] of Object.entries(bindings)) {
    if (!binding) {
      next[id] = null
      continue
    }

    for (const [existingId, existingBinding] of Object.entries(next)) {
      if (existingBinding && shortcutBindingsConflict(binding, existingBinding))
        next[existingId] = null
    }

    next[id] = binding
  }

  return next
}

/** 把 `Primary` 等抽象修饰键归一为当前平台的真实修饰键 */
export function normalizeShortcutModifiers(modifiers: ShortcutModifier[]): FnModifier[] {
  return Array.from(new Set(modifiers.map(normalizeShortcutModifier))).sort()
}

export function normalizeShortcutModifier(modifier: ShortcutModifier): FnModifier {
  if (modifier !== 'Primary')
    return modifier

  return isApplePlatform()
    ? 'Meta'
    : 'Control'
}

function isApplePlatform(): boolean {
  const maybeProcess = globalThis as typeof globalThis & {
    process?: { platform?: string }
  }
  if (maybeProcess.process?.platform)
    return maybeProcess.process.platform === 'darwin'

  const maybeNavigator = globalThis as typeof globalThis & {
    navigator?: { platform?: string, userAgent?: string }
  }
  const platform = maybeNavigator.navigator?.platform ?? ''
  const userAgent = maybeNavigator.navigator?.userAgent ?? ''
  return /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS X/i.test(userAgent)
}

function normalizeShortcutChord(chord: unknown): ShortcutChord | null {
  if (!isRecord(chord))
    return null

  if (chord.source === 'keyboard')
    return normalizeKeyboardShortcutChord(chord)
  if (chord.source === 'fn')
    return normalizeFnShortcutChord(chord)

  return null
}

function normalizeKeyboardShortcutChord(chord: Record<string, unknown>): KeyboardShortcutChord | null {
  if (typeof chord.key !== 'string' || !chord.key)
    return null

  return {
    source: 'keyboard',
    key: chord.key,
    modifiers: normalizeShortcutModifierList(chord.modifiers),
  }
}

function normalizeFnShortcutChord(chord: Record<string, unknown>): ShortcutChord | null {
  const key = normalizeFnShortcutKey(chord.key)
  if (!key)
    return null

  if (key === 'Fn') {
    return {
      source: 'fn',
      key,
    }
  }

  return {
    source: 'fn',
    key,
    modifiers: normalizeShortcutModifierList(chord.modifiers),
  }
}

function normalizeShortcutScope(scope: unknown): ShortcutScope {
  return scope === 'local'
    ? 'local'
    : 'global'
}

function normalizeShortcutGesture(gesture: unknown): ShortcutGestureType | null {
  return isShortcutGesture(gesture)
    ? gesture
    : null
}

function normalizeFnShortcutKey(key: unknown): FnShortcutKey | null {
  return isFnShortcutKey(key)
    ? key
    : null
}

function normalizeShortcutModifierList(modifiers: unknown): ShortcutModifier[] {
  if (!Array.isArray(modifiers))
    return []

  return Array.from(new Set(modifiers.filter(isShortcutModifier)))
}

function normalizePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function isShortcutGesture(value: unknown): value is ShortcutGestureType {
  return typeof value === 'string'
    && (SHORTCUT_GESTURES as readonly string[]).includes(value)
}

function isShortcutModifier(value: unknown): value is ShortcutModifier {
  return value === 'Primary'
    || value === 'Meta'
    || value === 'Control'
    || value === 'Alt'
    || value === 'Shift'
}

function isFnShortcutKey(value: unknown): value is FnShortcutKey {
  return typeof value === 'string'
    && (FN_SHORTCUT_KEYS as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

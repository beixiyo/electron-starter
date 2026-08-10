import type {
  FnModifier,
  FnShortcutKey,
  KeyboardCode,
  KeyboardShortcutChord,
  ShortcutBinding,
  ShortcutBindings,
  ShortcutChord,
  ShortcutGestureType,
  ShortcutModifier,
} from './types'
import {
  FN_SHORTCUT_KEYS,
  KEYBOARD_CODE_ALIASES,
  KEYBOARD_CODES,
  KEYBOARD_MODIFIER_BY_CODE,
  KEYBOARD_MODIFIER_CODES,
  SHORTCUT_GESTURES,
} from './types'

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

/**
 * 保存配置前校验并归一化外部输入
 *
 * 读取持久化配置时使用 {@link normalizeShortcutBindings} 容错；IPC 写入和
 * localStorage 写入则应调用本函数，避免未知 keyboard code 被静默变成禁用项
 */
export function normalizeShortcutBindingsOrThrow(bindings: unknown): ShortcutBindings {
  if (!isRecord(bindings))
    throw new TypeError('快捷键配置必须是对象')

  return Object.fromEntries(
    Object.entries(bindings).map(([id, binding]) => {
      if (binding === null)
        return [id, null]

      const normalized = normalizeShortcutBinding(binding)
      if (!normalized)
        throw new TypeError(`快捷键配置无效: ${id}`)

      return [id, normalized]
    }),
  )
}

/** 把单个 binding 补齐到当前结构；外部 JSON 缺 scope 时默认按桌面全局快捷键处理 */
export function normalizeShortcutBinding(binding: unknown): ShortcutBinding | null {
  if (!binding)
    return null
  if (!isRecord(binding))
    return null

  const gesture = isShortcutGesture(binding.gesture)
    ? binding.gesture
    : null
  if (!gesture || !isRecord(binding.chord))
    return null

  const chord = binding.chord.source === 'keyboard'
    ? parseKeyboardShortcutChord(binding.chord)
    : binding.chord.source === 'fn'
      ? normalizeFnShortcutChord(binding.chord)
      : null
  if (!chord)
    return null

  const normalized: ShortcutBinding = {
    scope: binding.scope === 'local'
      ? 'local'
      : 'global',
    gesture,
    chord,
  }

  if (
    typeof binding.intervalMs === 'number'
    && Number.isFinite(binding.intervalMs)
    && binding.intervalMs > 0
  ) {
    normalized.intervalMs = binding.intervalMs
  }

  if (
    typeof binding.minDurationMs === 'number'
    && Number.isFinite(binding.minDurationMs)
    && binding.minDurationMs > 0
  ) {
    normalized.minDurationMs = binding.minDurationMs
  }

  return normalized
}

/**
 * 将浏览器、uIOhook 和旧配置中的普通键名归一为规范键名
 *
 * 返回 null 表示该键没有跨捕获后端的可靠映射，保存边界应拒绝它
 */
export function normalizeKeyboardCode(value: unknown): KeyboardCode | null {
  if (typeof value !== 'string' || !value)
    return null

  if ((KEYBOARD_CODES as readonly string[]).includes(value))
    return value as KeyboardCode

  return KEYBOARD_CODE_ALIASES[value] ?? null
}

/**
 * 将浏览器或 uIOhook 捕获的主键和修饰键转换为统一的 keyboard chord
 *
 * 普通组合保留原主键；纯修饰键组合按固定顺序选取主键，使不同按下顺序
 * 得到相同的持久化和运行时结构
 */
export function normalizeKeyboardShortcutChord(
  key: KeyboardCode,
  modifiers: ShortcutModifier[],
): KeyboardShortcutChord {
  const mainModifier = KEYBOARD_MODIFIER_BY_CODE[key]
  if (!mainModifier)
    return { source: 'keyboard', key, modifiers }

  const members = new Set<FnModifier>([
    mainModifier,
    ...modifiers.filter((modifier): modifier is FnModifier => modifier !== 'Primary'),
  ])
  const canonicalKey = KEYBOARD_MODIFIER_CODES.find(code => members.has(KEYBOARD_MODIFIER_BY_CODE[code]!)) ?? key
  const canonicalModifier = KEYBOARD_MODIFIER_BY_CODE[canonicalKey]

  return {
    source: 'keyboard',
    key: canonicalKey,
    modifiers: [
      ...KEYBOARD_MODIFIER_CODES
        .map(code => KEYBOARD_MODIFIER_BY_CODE[code]!)
        .filter(modifier => modifier !== canonicalModifier && members.has(modifier)),
      ...modifiers.includes('Primary')
        ? ['Primary' as const]
        : [],
    ],
  }
}

/** 判断新的 keyboard chord 是否在已按住的纯修饰键 chord 上继续扩展 */
export function isKeyboardModifierChordPrefixOf(previous: ShortcutChord, next: ShortcutChord): boolean {
  if (previous.source !== 'keyboard' || next.source !== 'keyboard')
    return false

  const previousMembers = getKeyboardModifierChordMembers(previous)
  if (!previousMembers)
    return false

  const nextMembers = new Set(next.modifiers.filter((modifier): modifier is FnModifier => modifier !== 'Primary'))
  const nextMainModifier = KEYBOARD_MODIFIER_BY_CODE[next.key]
  if (nextMainModifier)
    nextMembers.add(nextMainModifier)

  return previousMembers.every(modifier => nextMembers.has(modifier))
    && (nextMembers.size > previousMembers.length || !nextMainModifier)
}

/** 取出 keyup 对应的冻结 chord；纯修饰键组合由任一成员松开结束 */
export function releaseActiveKeyboardChord<Key>(
  activeChords: Map<Key, KeyboardShortcutChord>,
  keyId: Key,
): KeyboardShortcutChord | null {
  const ownChord = activeChords.get(keyId)
  if (!ownChord)
    return null

  activeChords.delete(keyId)
  let releasedChord = ownChord
  let releasedMembers = getKeyboardModifierChordMembers(ownChord)
  if (!releasedMembers)
    return ownChord

  for (const candidate of activeChords.values()) {
    const candidateMembers = getKeyboardModifierChordMembers(candidate)
    if (!candidateMembers || candidateMembers.length <= releasedMembers.length)
      continue
    if (!releasedMembers.every(modifier => candidateMembers.includes(modifier)))
      continue

    releasedChord = candidate
    releasedMembers = candidateMembers
  }

  for (const [activeKeyId, candidate] of activeChords) {
    const candidateMembers = getKeyboardModifierChordMembers(candidate)
    if (candidateMembers?.every(modifier => releasedMembers.includes(modifier)))
      activeChords.delete(activeKeyId)
  }

  return releasedChord
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
function normalizeShortcutModifiers(modifiers: ShortcutModifier[]): FnModifier[] {
  return Array.from(new Set(modifiers.map(normalizeShortcutModifier))).sort()
}

export function normalizeShortcutModifier(modifier: ShortcutModifier): FnModifier {
  if (modifier !== 'Primary')
    return modifier

  return PRIMARY_MODIFIER
}

const PRIMARY_MODIFIER: FnModifier = detectApplePlatform()
  ? 'Meta'
  : 'Control'

function detectApplePlatform(): boolean {
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

function parseKeyboardShortcutChord(chord: Record<string, unknown>): KeyboardShortcutChord | null {
  const key = normalizeKeyboardCode(chord.key)
  if (!key)
    return null

  return normalizeKeyboardShortcutChord(key, normalizeShortcutModifierList(chord.modifiers))
}

function getKeyboardModifierChordMembers(chord: KeyboardShortcutChord): FnModifier[] | null {
  const mainModifier = KEYBOARD_MODIFIER_BY_CODE[chord.key]
  if (!mainModifier || chord.modifiers.includes('Primary'))
    return null

  return Array.from(new Set([
    mainModifier,
    ...chord.modifiers.filter((modifier): modifier is FnModifier => modifier !== 'Primary'),
  ]))
}

function normalizeFnShortcutChord(chord: Record<string, unknown>): ShortcutChord | null {
  if (!isFnShortcutKey(chord.key))
    return null

  const key = chord.key
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

function normalizeShortcutModifierList(modifiers: unknown): ShortcutModifier[] {
  if (!Array.isArray(modifiers))
    return []

  return Array.from(new Set(modifiers.filter(isShortcutModifier)))
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

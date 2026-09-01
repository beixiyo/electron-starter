import type {
  ActiveKeyboardShortcutEntry,
  FnModifier,
  FnShortcutKey,
  KeyboardCode,
  KeyboardModifierCode,
  KeyboardShortcutChord,
  KeyboardShortcutModifier,
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
  if (a.source !== b.source)
    return false

  if (a.source === 'keyboard' && b.source === 'keyboard') {
    const left = normalizeKeyboardShortcutChord(a.key, a.modifiers)
    const right = normalizeKeyboardShortcutChord(b.key, b.modifiers)

    if (isKeyboardModifierCode(left.key) || isKeyboardModifierCode(right.key)) {
      if (!isKeyboardModifierCode(left.key) || !isKeyboardModifierCode(right.key))
        return false

      return shortcutModifiersEqual(
        [left.key, ...left.modifiers],
        [right.key, ...right.modifiers],
      )
    }

    return left.key === right.key
      && shortcutModifiersEqual(left.modifiers, right.modifiers)
  }

  return a.key === b.key
    && shortcutModifiersEqual(a.modifiers ?? [], b.modifiers ?? [])
}

export function shortcutModifiersEqual(
  a: readonly KeyboardShortcutModifier[],
  b: readonly KeyboardShortcutModifier[],
): boolean {
  const left = groupKeyboardShortcutModifiers(a)
  const right = groupKeyboardShortcutModifiers(b)

  if (!sameSet(new Set(left.keys()), new Set(right.keys())))
    return false

  for (const [family, leftState] of left) {
    const rightState = right.get(family)!
    /** 逻辑 modifier 表示该家族至少按住一侧；物理 modifier 则要求侧别集合完全一致 */
    if (leftState.logical || rightState.logical)
      continue
    if (!sameSet(leftState.physical, rightState.physical))
      return false
  }

  return true
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
 * 普通组合保留原主键；单个物理修饰键保留左右侧，多个修饰键则按固定
 * 物理键顺序选取主键，使不同按下顺序得到相同的持久化和运行时结构
 */
export function normalizeKeyboardShortcutChord(
  key: KeyboardCode,
  modifiers: KeyboardShortcutModifier[],
): KeyboardShortcutChord {
  const mainModifier = KEYBOARD_MODIFIER_BY_CODE[key]
  if (!mainModifier)
    return {
      source: 'keyboard',
      key,
      modifiers: canonicalizeKeyboardShortcutModifiers(modifiers),
    }

  const physicalMembers = new Set<KeyboardModifierCode>([key as KeyboardModifierCode])
  for (const modifier of modifiers) {
    if (isKeyboardModifierCode(modifier))
      physicalMembers.add(modifier)
  }

  const logicalModifiers = modifiers.filter((modifier): modifier is ShortcutModifier => (
    !isKeyboardModifierCode(modifier)
      && !hasPhysicalModifier(physicalMembers, normalizeShortcutModifier(modifier))
  ))
  const canonicalKey = KEYBOARD_MODIFIER_CODES.find(code => physicalMembers.has(code)) ?? key

  return {
    source: 'keyboard',
    key: canonicalKey,
    modifiers: sortKeyboardShortcutModifiers([
      ...Array.from(physicalMembers).filter(code => code !== canonicalKey),
      ...logicalModifiers,
    ]),
  }
}

/** 使用当前已按住的物理修饰键，将 KeyboardEvent/uiohook 的逻辑 flags 补全为左右侧 */
export function specializeKeyboardShortcutModifiers(
  modifiers: ShortcutModifier[],
  activeEntries: Iterable<ActiveKeyboardShortcutEntry>,
): KeyboardShortcutModifier[] {
  const physicalModifiers = new Set<KeyboardModifierCode>()

  for (const entry of activeEntries) {
    if (isKeyboardModifierCode(entry.key))
      physicalModifiers.add(entry.key)
  }

  return canonicalizeKeyboardShortcutModifiers([
    ...physicalModifiers,
    ...modifiers.filter(modifier => (
      modifier === 'Primary' || !hasPhysicalModifier(physicalModifiers, modifier)
    )),
  ])
}

/** 记录物理键 keydown，并返回该时刻冻结的 keyboard chord */
export function pressKeyboardShortcutChord<Key>(
  activeEntries: Map<Key, ActiveKeyboardShortcutEntry>,
  keyId: Key,
  key: KeyboardCode,
  modifiers: ShortcutModifier[],
): KeyboardShortcutChord {
  const entry: ActiveKeyboardShortcutEntry = {
    key,
    chord: normalizeKeyboardShortcutChord(
      key,
      specializeKeyboardShortcutModifiers(modifiers, activeEntries.values()),
    ),
  }
  activeEntries.set(keyId, entry)
  return entry.chord
}

/** 判断新的 keyboard chord 是否在已按住的纯修饰键 chord 上继续扩展 */
export function isKeyboardModifierChordPrefixOf(previous: ShortcutChord, next: ShortcutChord): boolean {
  if (previous.source !== 'keyboard' || next.source !== 'keyboard')
    return false

  const previousMembers = getKeyboardModifierChordMembers(previous)
  if (!previousMembers)
    return false

  const nextMembers = getKeyboardModifierChordMembers(next)
    ?? next.modifiers.filter(modifier => modifier !== 'Primary')
  const nextMainModifier = KEYBOARD_MODIFIER_BY_CODE[next.key]

  return keyboardModifierListContainsAll(nextMembers, previousMembers)
    && (nextMembers.length > previousMembers.length || !nextMainModifier)
}

/**
 * 释放一个物理键，并返回所有依赖该成员的冻结 chord
 *
 * 仍按住的键会按当前 modifier 状态重算，避免已经松开的物理修饰键从旧 chord
 * 重新进入后续输入。返回值按成员数从多到少排序，供录制状态机优先结束完整组合
 */
export function releaseActiveKeyboardChords<Key>(
  activeEntries: Map<Key, ActiveKeyboardShortcutEntry>,
  keyId: Key,
  modifiers: ShortcutModifier[],
): KeyboardShortcutChord[] {
  const ownEntry = activeEntries.get(keyId)
  if (!ownEntry)
    return []

  const releasedKey = ownEntry.key
  const releasedChords = Array.from(activeEntries.values())
    .filter(entry => (
      entry === ownEntry
      || keyboardChordContainsPhysicalKey(entry.chord, releasedKey)
    ))
    .map(entry => entry.chord)

  activeEntries.delete(keyId)
  for (const entry of activeEntries.values()) {
    entry.chord = normalizeKeyboardShortcutChord(
      entry.key,
      specializeKeyboardShortcutModifiers(modifiers, activeEntries.values()),
    )
  }

  return uniqueKeyboardShortcutChords(releasedChords)
    .sort((a, b) => b.modifiers.length - a.modifiers.length)
}

/** 当前物理 modifier 状态是否精确满足 chord；逻辑 modifier 仍表示该家族任一侧 */
export function keyboardShortcutChordMatchesModifierState(
  chord: KeyboardShortcutChord,
  activePhysicalModifiers: ReadonlySet<KeyboardModifierCode>,
  logicalModifiers: readonly ShortcutModifier[],
): boolean {
  const expectedLogical = new Set<FnModifier>()
  const expectedPhysical = new Map<FnModifier, Set<KeyboardModifierCode>>()

  for (const modifier of chord.modifiers) {
    if (isKeyboardModifierCode(modifier)) {
      const logical = KEYBOARD_MODIFIER_BY_CODE[modifier]!
      expectedLogical.add(logical)
      const family = expectedPhysical.get(logical) ?? new Set<KeyboardModifierCode>()
      family.add(modifier)
      expectedPhysical.set(logical, family)
      continue
    }

    expectedLogical.add(normalizeShortcutModifier(modifier))
  }

  if (isKeyboardModifierCode(chord.key)) {
    const logical = KEYBOARD_MODIFIER_BY_CODE[chord.key]!
    expectedLogical.add(logical)
    const family = expectedPhysical.get(logical) ?? new Set<KeyboardModifierCode>()
    family.add(chord.key)
    expectedPhysical.set(logical, family)
  }

  const actualLogical = new Set(logicalModifiers.map(normalizeShortcutModifier))
  if (!sameSet(expectedLogical, actualLogical))
    return false

  for (const [logical, expectedFamily] of expectedPhysical) {
    const actualFamily = new Set(
      Array.from(activePhysicalModifiers)
        .filter(code => KEYBOARD_MODIFIER_BY_CODE[code] === logical),
    )
    if (!sameSet(expectedFamily, actualFamily))
      return false
  }

  return true
}

/** 读取当前仍按住的物理 modifier */
export function getActiveKeyboardModifierCodes(
  activeEntries: Iterable<ActiveKeyboardShortcutEntry>,
): Set<KeyboardModifierCode> {
  return new Set(
    Array.from(activeEntries)
      .map(entry => entry.key)
      .filter(isKeyboardModifierCode),
  )
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
  const modifiers = normalizeKeyboardShortcutModifierList(chord.modifiers)
  if (!key || !modifiers)
    return null
  if (isKeyboardModifierCode(key)
    && hasMixedLogicalAndPhysicalModifierFamily([key, ...modifiers])) {
    return null
  }

  return normalizeKeyboardShortcutChord(key, modifiers)
}

function getKeyboardModifierChordMembers(chord: KeyboardShortcutChord): KeyboardShortcutModifier[] | null {
  if (!isKeyboardModifierCode(chord.key) || chord.modifiers.includes('Primary'))
    return null

  return sortKeyboardShortcutModifiers([chord.key, ...chord.modifiers])
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

  const modifiers = normalizeShortcutModifierList(chord.modifiers)
  if (!modifiers)
    return null

  return {
    source: 'fn',
    key,
    modifiers,
  }
}

function normalizeShortcutModifierList(modifiers: unknown): ShortcutModifier[] | null {
  if (!Array.isArray(modifiers))
    return []

  const normalized = Array.from(new Set(modifiers.filter(isShortcutModifier)))
  return hasDuplicateLogicalModifierFamily(normalized)
    ? null
    : normalized
}

function normalizeKeyboardShortcutModifierList(modifiers: unknown): KeyboardShortcutModifier[] | null {
  if (!Array.isArray(modifiers))
    return []

  const normalized = Array.from(new Set(modifiers.filter(isKeyboardShortcutModifier)))
  return hasMixedLogicalAndPhysicalModifierFamily(normalized)
    || hasDuplicateLogicalModifierFamily(normalized)
    ? null
    : normalized
}

function normalizeKeyboardShortcutModifiers(
  modifiers: readonly KeyboardShortcutModifier[],
): Array<FnModifier | KeyboardModifierCode> {
  return canonicalizeKeyboardShortcutModifiers(modifiers).map(modifier => (
    modifier === 'Primary'
      ? PRIMARY_MODIFIER
      : modifier
  ))
}

function canonicalizeKeyboardShortcutModifiers(
  modifiers: Iterable<KeyboardShortcutModifier>,
): KeyboardShortcutModifier[] {
  const unique = new Set(modifiers)
  const physicalModifiers = new Set(
    Array.from(unique).filter(isKeyboardModifierCode),
  )
  const logicalFamilies = new Set<FnModifier>()

  return sortKeyboardShortcutModifiers(unique).filter((modifier) => {
    if (isKeyboardModifierCode(modifier))
      return true

    const family = normalizeShortcutModifier(modifier)
    if (hasPhysicalModifier(physicalModifiers, family) || logicalFamilies.has(family))
      return false

    logicalFamilies.add(family)
    return true
  })
}

function sortKeyboardShortcutModifiers(
  modifiers: Iterable<KeyboardShortcutModifier>,
): KeyboardShortcutModifier[] {
  const unique = new Set(modifiers)
  const logicalOrder: readonly ShortcutModifier[] = ['Primary', 'Meta', 'Control', 'Alt', 'Shift']

  return [
    ...KEYBOARD_MODIFIER_CODES.filter(code => unique.delete(code)),
    ...logicalOrder.filter(modifier => unique.delete(modifier)),
  ]
}

function keyboardModifierListContainsAll(
  container: readonly KeyboardShortcutModifier[],
  expected: readonly KeyboardShortcutModifier[],
): boolean {
  const remaining = [...container]

  for (const modifier of expected) {
    const index = remaining.findIndex(candidate => keyboardModifiersMatch(modifier, candidate))
    if (index < 0)
      return false
    remaining.splice(index, 1)
  }

  return true
}

function keyboardModifiersMatch(
  left: KeyboardShortcutModifier,
  right: KeyboardShortcutModifier,
): boolean {
  if (left === right)
    return true
  if (left === 'Primary' || right === 'Primary')
    return false

  const leftPhysical = isKeyboardModifierCode(left)
  const rightPhysical = isKeyboardModifierCode(right)
  if (leftPhysical && rightPhysical)
    return false

  return getLogicalModifier(left) === getLogicalModifier(right)
}

function hasPhysicalModifier(
  modifiers: ReadonlySet<KeyboardModifierCode>,
  logicalModifier: FnModifier,
): boolean {
  return Array.from(modifiers).some(code => KEYBOARD_MODIFIER_BY_CODE[code] === logicalModifier)
}

function getLogicalModifier(modifier: FnModifier | KeyboardModifierCode): FnModifier {
  return isKeyboardModifierCode(modifier)
    ? KEYBOARD_MODIFIER_BY_CODE[modifier]!
    : modifier
}

function groupKeyboardShortcutModifiers(
  modifiers: readonly KeyboardShortcutModifier[],
): Map<FnModifier, KeyboardModifierFamilyState> {
  const groups = new Map<FnModifier, KeyboardModifierFamilyState>()

  for (const modifier of normalizeKeyboardShortcutModifiers(modifiers)) {
    const family = getLogicalModifier(modifier)
    const state = groups.get(family) ?? {
      logical: false,
      physical: new Set<KeyboardModifierCode>(),
    }

    if (isKeyboardModifierCode(modifier))
      state.physical.add(modifier)
    else
      state.logical = true
    groups.set(family, state)
  }

  return groups
}

function hasDuplicateLogicalModifierFamily(
  modifiers: readonly KeyboardShortcutModifier[],
): boolean {
  const families = new Set<FnModifier>()

  for (const modifier of modifiers) {
    if (isKeyboardModifierCode(modifier))
      continue

    const family = normalizeShortcutModifier(modifier)
    if (families.has(family))
      return true
    families.add(family)
  }

  return false
}

function hasMixedLogicalAndPhysicalModifierFamily(
  modifiers: readonly KeyboardShortcutModifier[],
): boolean {
  const physicalModifiers = new Set(modifiers.filter(isKeyboardModifierCode))

  return modifiers.some(modifier => {
    if (isKeyboardModifierCode(modifier))
      return false

    return hasPhysicalModifier(physicalModifiers, normalizeShortcutModifier(modifier))
  })
}

function keyboardChordContainsPhysicalKey(
  chord: KeyboardShortcutChord,
  key: KeyboardCode,
): boolean {
  return chord.key === key || chord.modifiers.includes(key as KeyboardModifierCode)
}

function uniqueKeyboardShortcutChords(
  chords: readonly KeyboardShortcutChord[],
): KeyboardShortcutChord[] {
  return chords.filter((chord, index) => (
    chords.findIndex(candidate => shortcutChordsEqual(candidate, chord)) === index
  ))
}

function sameSet<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return left.size === right.size
    && Array.from(left).every(value => right.has(value))
}

type KeyboardModifierFamilyState = {
  logical: boolean
  physical: Set<KeyboardModifierCode>
}

export function isKeyboardModifierCode(value: unknown): value is KeyboardModifierCode {
  return typeof value === 'string'
    && (KEYBOARD_MODIFIER_CODES as readonly string[]).includes(value)
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

function isKeyboardShortcutModifier(value: unknown): value is KeyboardShortcutModifier {
  return isShortcutModifier(value) || isKeyboardModifierCode(value)
}

function isFnShortcutKey(value: unknown): value is FnShortcutKey {
  return typeof value === 'string'
    && (FN_SHORTCUT_KEYS as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

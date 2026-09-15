import { isRecord } from '@jl-org/tool'
import type {
  ActiveFnShortcutEntry,
  ActiveKeyboardShortcutEntry,
  FnModifier,
  FnShortcutChord,
  FnShortcutKey,
  KeyboardCode,
  KeyboardInputKey,
  KeyboardLockCode,
  KeyboardModifierCode,
  KeyboardPlainCode,
  KeyboardShortcutChord,
  KeyboardShortcutModifier,
  ShortcutBinding,
  ShortcutBindings,
  ShortcutChord,
  ShortcutGestureBinding,
  ShortcutGestureType,
  ShortcutModifier,
} from './types'
import {
  FN_SHORTCUT_KEYS,
  KEYBOARD_CODES,
  KEYBOARD_LOCK_CODES,
  KEYBOARD_MODIFIER_BY_CODE,
  KEYBOARD_MODIFIER_CODES,
  KEYBOARD_PLAIN_CODES,
  SHORTCUT_GESTURES,
} from './types'

export function shortcutChordsEqual(a: ShortcutChord, b: ShortcutChord): boolean {
  if (a.source !== b.source)
    return false

  if (a.source === 'keyboard' && b.source === 'keyboard') {
    const left = normalizeKeyboardShortcutChord(a.key, a.modifiers, a.keys)
    const right = normalizeKeyboardShortcutChord(b.key, b.modifiers, b.keys)

    if (isKeyboardModifierCode(left.key) || isKeyboardModifierCode(right.key)) {
      if (!isKeyboardModifierCode(left.key) || !isKeyboardModifierCode(right.key))
        return false

      return shortcutModifiersEqual(
        [left.key, ...left.modifiers],
        [right.key, ...right.modifiers],
      )
    }

    return left.key === right.key
      && sameList(left.keys ?? [], right.keys ?? [])
      && shortcutModifiersEqual(left.modifiers, right.modifiers)
  }

  /** Fn 组合的成员与 keyboard 路径一样先归一，`fn + ] + [` 与 `fn + [ + ]` 是同一个 chord */
  return sameList(toChordKeyList(a.key, a.keys), toChordKeyList(b.key, b.keys))
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
 * 校验外部输入是否为规范键名
 *
 * 返回 null 表示该键不在统一命名空间内，保存边界应拒绝它；各捕获后端的私有键名
 * 必须在 adapter 里完成转换，不在这里做别名兜底
 */
export function normalizeKeyboardCode(value: unknown): KeyboardCode | null {
  if (typeof value !== 'string' || !value)
    return null

  return (KEYBOARD_CODES as readonly string[]).includes(value)
    ? value as KeyboardCode
    : null
}

/**
 * 将浏览器或 uIOhook 捕获的主键和修饰键转换为统一的 keyboard chord
 *
 * 普通组合保留原主键；单个物理修饰键保留左右侧，多个修饰键则按固定
 * 物理键顺序选取主键，使不同按下顺序得到相同的持久化和运行时结构
 *
 * `keys` 是与主键同时按住的其他普通键（`[ + ]`），成员按 `KEYBOARD_PLAIN_CODES` 顺序归一，主键取
 * 最靠前的一个，同样与按下顺序无关；主键是修饰键时成员被丢弃，持久化边界要先用 {@link normalizeShortcutBinding} 拒绝
 */
export function normalizeKeyboardShortcutChord(
  key: KeyboardCode,
  modifiers: KeyboardShortcutModifier[],
  keys: readonly KeyboardPlainCode[] = [],
): KeyboardShortcutChord {
  const mainModifier = KEYBOARD_MODIFIER_BY_CODE[key]
  if (!mainModifier) {
    const members = canonicalizeChordKeys(key, keys)
    const chord: KeyboardShortcutChord = {
      source: 'keyboard',
      key: members.key,
      modifiers: canonicalizeKeyboardShortcutModifiers(modifiers),
    }
    if (members.keys.length)
      chord.keys = members.keys

    return chord
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

/** 记录物理键 keydown，并返回该时刻冻结的 keyboard chord；此刻按住的其他普通键一并进入 chord */
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
      getHeldPlainKeys(activeEntries.values(), key),
    ),
  }
  activeEntries.set(keyId, entry)
  return entry.chord
}

/** 记录 Fn 组合键 keydown，并返回该时刻冻结的 Fn chord；此刻按住的其他 Fn 组合键一并进入 chord */
export function pressFnShortcutChord(
  activeEntries: Map<KeyboardPlainCode, ActiveFnShortcutEntry>,
  key: KeyboardPlainCode,
  modifiers: KeyboardShortcutModifier[],
): FnShortcutChord {
  const entry: ActiveFnShortcutEntry = {
    key,
    chord: normalizeFnComboChord(key, modifiers, getHeldPlainKeys(activeEntries.values(), key)),
  }
  activeEntries.set(key, entry)
  return entry.chord
}

/**
 * 判断 next 是否在仍按住的 previous 上继续扩展
 *
 * 四种情况：纯修饰键组合追加新成员、Fn chord 追加修饰键或主键、纯修饰键组合并入 Fn chord，
 * 以及普通主键追加成员（`[` → `[ + ]`、`fn + [` → `fn + [ + ]`）
 *
 * 手势与录制状态机共用这一个判据：前者据此撤销 previous 的候选，避免 Fn+Space 同时
 * 触发「按下 Fn」；后者据此把 activeChord 换成更长的组合。两边必须一致，否则录下来的
 * 组合和实际会触发的组合不是一回事
 */
export function isShortcutChordPrefixOf(previous: ShortcutChord, next: ShortcutChord): boolean {
  if (next.source === 'fn') {
    return previous.source === 'fn'
      ? isFnChordPrefixOf(previous, next)
      : isKeyboardModifierChordPrefixOfFn(previous, next)
  }

  if (previous.source === 'fn')
    return false

  return isKeyboardModifierChordPrefixOf(previous, next)
    || isKeyboardChordKeysPrefixOf(previous, next)
}

/**
 * 修饰键家族被包含的前提下：`key: 'Fn'` 的 chord 要么被追加修饰键、要么换成了普通主键；
 * 普通主键的 Fn 组合则要在自己的全部成员之上追加成员（`fn + [` → `fn + [ + ]`）
 */
function isFnChordPrefixOf(previous: FnShortcutChord, next: FnShortcutChord): boolean {
  const previousFamilies = toModifierFamilies(previous.modifiers ?? [])
  const nextFamilies = toModifierFamilies(next.modifiers ?? [])
  if (!previousFamilies.every(family => nextFamilies.includes(family)))
    return false

  if (previous.key === 'Fn')
    return next.key !== 'Fn' || nextFamilies.length > previousFamilies.length

  return next.key !== 'Fn' && chordKeysExtend(previous, next)
}

/** 纯修饰键 keyboard chord 的全部家族都出现在 Fn chord 的修饰键里时，它是该 Fn chord 的前缀 */
function isKeyboardModifierChordPrefixOfFn(previous: KeyboardShortcutChord, next: FnShortcutChord): boolean {
  if (!isKeyboardModifierCode(previous.key))
    return false

  const nextFamilies = toModifierFamilies(next.modifiers ?? [])
  return toModifierFamilies([previous.key, ...previous.modifiers])
    .every(family => nextFamilies.includes(family))
}

/**
 * 判断新的 keyboard chord 是否在已按住的普通主键 chord 上追加了成员（`[` → `[ + ]`）
 *
 * 修饰键允许 next 比 previous 多：先按 `[` 再按 ⌘ 再按 `]` 时 ⌘ 已经冻结进 `⌘ + [ + ]`，
 * 物理上仍是在 previous 的全部成员之上继续按，状态机据此把候选换成完整组合
 */
function isKeyboardChordKeysPrefixOf(previous: KeyboardShortcutChord, next: KeyboardShortcutChord): boolean {
  if (isKeyboardModifierCode(previous.key) || isKeyboardModifierCode(next.key))
    return false

  return chordKeysExtend(previous, next)
    && keyboardModifierListContainsAll(next.modifiers, previous.modifiers)
}

/** next 的普通键成员严格包含 previous 的全部成员 */
function chordKeysExtend(previous: ShortcutChord, next: ShortcutChord): boolean {
  const previousKeys = toChordKeyList(previous.key, previous.keys)
  const nextKeys = toChordKeyList(next.key, next.keys)

  return nextKeys.length > previousKeys.length
    && previousKeys.every(key => nextKeys.includes(key))
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
      getHeldPlainKeys(activeEntries.values(), entry.key),
    )
  }

  return uniqueShortcutChords(releasedChords)
    .sort((a, b) => countChordMembers(b) - countChordMembers(a))
}

/**
 * 释放一个 Fn 组合键，并返回所有依赖该成员的冻结 chord
 *
 * 仍按住的键保留各自 down 时冻结的修饰键，只把松开的成员从组合里去掉；
 * 返回值与 keyboard 路径一样按成员数从多到少排序
 */
export function releaseFnShortcutChords(
  activeEntries: Map<KeyboardPlainCode, ActiveFnShortcutEntry>,
  key: KeyboardPlainCode,
): FnShortcutChord[] {
  const ownEntry = activeEntries.get(key)
  if (!ownEntry)
    return []

  const releasedChords = Array.from(activeEntries.values())
    .filter(entry => entry === ownEntry || toChordKeyList(entry.chord.key, entry.chord.keys).includes(key))
    .map(entry => entry.chord)

  activeEntries.delete(key)
  for (const entry of activeEntries.values()) {
    entry.chord = normalizeFnComboChord(
      entry.key,
      entry.chord.modifiers ?? [],
      getHeldPlainKeys(activeEntries.values(), entry.key),
    )
  }

  return uniqueShortcutChords(releasedChords)
    .sort((a, b) => countChordMembers(b) - countChordMembers(a))
}

/** 当前仍按住的其他普通键；顺序无关，进入 chord 前会归一 */
function getHeldPlainKeys(
  activeEntries: Iterable<{ key: KeyboardCode }>,
  key: KeyboardCode,
): KeyboardPlainCode[] {
  const held: KeyboardPlainCode[] = []

  for (const entry of activeEntries) {
    if (entry.key !== key && isKeyboardPlainCode(entry.key))
      held.push(entry.key)
  }

  return held
}

/** 主键、修饰键与普通键成员各算一个；只用于同一输入源内部排序 */
function countChordMembers(chord: ShortcutChord): number {
  return 1 + (chord.modifiers?.length ?? 0) + (chord.keys?.length ?? 0)
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

/**
 * 判断两个 binding 是否会在运行时互相抢占
 *
 * 接受不带 scope 的 {@link ShortcutGestureBinding}：录制结果在写入前还没有 scope，
 * 而冲突只由 chord 与 gesture 决定，scope 不参与判定
 */
export function shortcutBindingsConflict(a: ShortcutGestureBinding, b: ShortcutGestureBinding): boolean {
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

  const keys = parseChordKeys(key, chord.keys)
  if (!keys)
    return null

  return normalizeKeyboardShortcutChord(key, modifiers, keys)
}

/** `keys` 缺省视为空；出现时每个成员都必须是不等于主键的普通键，主键不是普通键（修饰键、`Fn`）时不能有成员 */
function parseChordKeys(key: KeyboardInputKey, value: unknown): KeyboardPlainCode[] | null {
  if (value === undefined)
    return []
  if (!Array.isArray(value))
    return null
  if (value.length === 0)
    return []
  if (!isKeyboardPlainCode(key))
    return null

  const keys = value.map(normalizeKeyboardCode)
  const valid = keys.every((member): member is KeyboardPlainCode => (
    !!member && member !== key && isKeyboardPlainCode(member)
  ))

  return valid
    ? keys
    : null
}

/**
 * 主键与成员去重后按 `KEYBOARD_PLAIN_CODES` 顺序排列，首位即归一后的主键
 *
 * 主键不是普通键（修饰键、`Fn`）时没有成员可言，原样返回
 */
function canonicalizeChordKeys<Key extends KeyboardInputKey>(
  key: Key,
  keys: readonly KeyboardPlainCode[],
): { key: Key | KeyboardPlainCode, keys: KeyboardPlainCode[] } {
  if (!isKeyboardPlainCode(key))
    return { key, keys: [] }

  const members = new Set<KeyboardPlainCode>([key, ...keys])
  const [mainKey, ...restKeys] = KEYBOARD_PLAIN_CODES.filter(code => members.has(code))

  return { key: mainKey, keys: restKeys }
}

/** 主键与成员摊平成一个列表，比较与包含判断用 */
function toChordKeyList(key: KeyboardInputKey, keys: readonly KeyboardPlainCode[] | undefined): KeyboardInputKey[] {
  const members = canonicalizeChordKeys(key, keys ?? [])
  return [members.key, ...members.keys]
}

/** Fn 组合键 chord：主键与成员按普通键顺序归一，修饰键与 keyboard chord 同一套归一（物理侧别在前） */
function normalizeFnComboChord(
  key: KeyboardPlainCode,
  modifiers: Iterable<KeyboardShortcutModifier>,
  keys: readonly KeyboardPlainCode[],
): FnShortcutChord {
  const members = canonicalizeChordKeys(key, keys)
  const chord: FnShortcutChord = {
    source: 'fn',
    key: members.key,
    modifiers: canonicalizeKeyboardShortcutModifiers(modifiers),
  }
  if (members.keys.length)
    chord.keys = members.keys

  return chord
}

function getKeyboardModifierChordMembers(chord: KeyboardShortcutChord): KeyboardShortcutModifier[] | null {
  if (!isKeyboardModifierCode(chord.key) || chord.modifiers.includes('Primary'))
    return null

  return sortKeyboardShortcutModifiers([chord.key, ...chord.modifiers])
}

/**
 * 裸 Fn 不带 modifiers 字段；`fn + ⌘` 这类 Fn 修饰键 chord 与 Fn 组合键一样按 keyboard chord 的规则
 * 收修饰键：物理侧别与逻辑家族都接受，同一家族不能既有侧别又有逻辑值
 */
function normalizeFnShortcutChord(chord: Record<string, unknown>): ShortcutChord | null {
  if (!isFnShortcutKey(chord.key))
    return null

  const key = chord.key
  const modifiers = normalizeKeyboardShortcutModifierList(chord.modifiers)
  if (!modifiers)
    return null

  const keys = parseChordKeys(key, chord.keys)
  if (!keys)
    return null

  if (key !== 'Fn')
    return normalizeFnComboChord(key, modifiers, keys)

  if (modifiers.length === 0) {
    return {
      source: 'fn',
      key,
    }
  }

  return {
    source: 'fn',
    key,
    modifiers: canonicalizeKeyboardShortcutModifiers(modifiers),
  }
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

/** 把物理侧别与 `Primary` 一并收敛成逻辑家族并去重，顺序按首次出现 */
function toModifierFamilies(modifiers: Iterable<KeyboardShortcutModifier>): FnModifier[] {
  const families = new Set<FnModifier>()

  for (const modifier of modifiers) {
    families.add(
      isKeyboardModifierCode(modifier)
        ? KEYBOARD_MODIFIER_BY_CODE[modifier]!
        : normalizeShortcutModifier(modifier),
    )
  }

  return Array.from(families)
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

  return modifiers.some((modifier) => {
    if (isKeyboardModifierCode(modifier))
      return false

    return hasPhysicalModifier(physicalModifiers, normalizeShortcutModifier(modifier))
  })
}

function keyboardChordContainsPhysicalKey(
  chord: KeyboardShortcutChord,
  key: KeyboardCode,
): boolean {
  return chord.key === key
    || chord.modifiers.includes(key as KeyboardModifierCode)
    || toChordKeyList(chord.key, chord.keys).includes(key)
}

function uniqueShortcutChords<T extends ShortcutChord>(chords: readonly T[]): T[] {
  return chords.filter((chord, index) => (
    chords.findIndex(candidate => shortcutChordsEqual(candidate, chord)) === index
  ))
}

function sameSet<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return left.size === right.size
    && Array.from(left).every(value => right.has(value))
}

function sameList<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

type KeyboardModifierFamilyState = {
  logical: boolean
  physical: Set<KeyboardModifierCode>
}

export function isKeyboardModifierCode(value: unknown): value is KeyboardModifierCode {
  return typeof value === 'string'
    && (KEYBOARD_MODIFIER_CODES as readonly string[]).includes(value)
}

/** 是否是只切换状态、不参与 chord 的锁定键 */
export function isKeyboardLockCode(value: unknown): value is KeyboardLockCode {
  return typeof value === 'string'
    && (KEYBOARD_LOCK_CODES as readonly string[]).includes(value)
}

export function isKeyboardPlainCode(value: unknown): value is KeyboardPlainCode {
  return typeof value === 'string'
    && (KEYBOARD_PLAIN_CODES as readonly string[]).includes(value)
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

/** 是否是 Fn chord 能用的主键：规范键名去掉修饰键与锁定键，外加 `Fn` 自己 */
export function isFnShortcutKey(value: unknown): value is FnShortcutKey {
  return typeof value === 'string'
    && (FN_SHORTCUT_KEYS as readonly string[]).includes(value)
}

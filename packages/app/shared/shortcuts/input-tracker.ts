/** 原始物理输入 → chord 事件：所有捕获后端共用的按键状态合成器 */

import type {
  ActiveFnShortcutEntry,
  ActiveKeyboardShortcutEntry,
  FnShortcutChord,
  KeyboardCode,
  KeyboardInput,
  KeyboardInputEvent,
  KeyboardModifierCode,
  KeyboardPlainCode,
  ShortcutRecordEvent,
} from './types'
import { KEYBOARD_MODIFIER_BY_CODE, KEYBOARD_MODIFIER_CODES } from './types'
import {
  getActiveKeyboardModifierCodes,
  isKeyboardLockCode,
  isKeyboardModifierCode,
  isKeyboardPlainCode,
  normalizeShortcutModifier,
  pressFnShortcutChord,
  pressKeyboardShortcutChord,
  releaseActiveKeyboardChords,
  releaseFnShortcutChords,
  specializeKeyboardShortcutModifiers,
} from './utils'

const FN_CHORD: FnShortcutChord = { source: 'fn', key: 'Fn' }

/**
 * 创建键盘输入 tracker
 *
 * 输入是各后端归一后的 {@link KeyboardInput}，输出是录制状态机与手势状态机共同消费的
 * {@link ShortcutRecordEvent}。chord 在 keydown 时冻结：普通键带上此刻按住的物理修饰键，
 * 以及其他仍按住的普通键（`[ + ]`）；Fn 组合键同样带上物理修饰键与其他仍按住的 Fn 组合键；
 * 任一成员松开时结束依赖它的全部 chord，Fn 松开则按 down 顺序结束所有 Fn 组合
 *
 * 修饰键自身永远走 keyboard 路径，即便此时 Fn 按住；但 Fn 与修饰键同时按住时额外合成
 * `fn + ⌘` 这类 Fn 修饰键 chord（`key: 'Fn'` 带 modifiers）。Fn 路径的修饰键都取自 tracker
 * 自己记录的物理按住状态而不是事件本身携带的逻辑 flags：Fn 组合键事件只给逻辑家族，
 * 「先按 ⌘ 再按 Fn」与 `fn + Left ⌥` 的侧别都只能靠这里补上；两种按下顺序得到同一个 chord
 *
 * 系统重复按下由后端过滤，这里再用「已按住即忽略」兜底一次；锁定键不参与任何 chord
 */
export function createKeyboardInputTracker(): KeyboardInputTracker {
  const keyboardEntries = new Map<KeyboardCode, ActiveKeyboardShortcutEntry>()
  const fnEntries = new Map<KeyboardPlainCode, ActiveFnShortcutEntry>()
  let fnDown = false
  /** Fn 键自身在 down 时冻结的 chord：裸 Fn，或 Fn 按下时已按住修饰键的组合 */
  let fnChord: FnShortcutChord | null = null
  /** Fn 按住期间按下的修饰键各自冻结的组合，按 down 顺序 */
  const fnModifierChords = new Map<KeyboardModifierCode, FnShortcutChord>()

  const handle = (input: KeyboardInput): ShortcutRecordEvent[] => {
    if (input.phase === 'reset') {
      reset()
      return []
    }
    if (isKeyboardLockCode(input.key))
      return []

    return input.phase === 'down'
      ? handleDown(input)
      : handleUp(input)
  }

  const handleDown = (event: KeyboardInputEvent): ShortcutRecordEvent[] => {
    const { key, timestamp } = event

    if (key === 'Fn') {
      if (fnDown)
        return []

      fnDown = true
      fnChord = createFnChord()
      return [{ phase: 'down', chord: fnChord, timestamp }]
    }

    if (isFnComboKey(key, event)) {
      if (fnEntries.has(key))
        return []

      /** 事件只给逻辑家族，按 tracker 记录的物理按住状态补成侧别，与 keyboard 路径同一套 */
      const chord = pressFnShortcutChord(
        fnEntries,
        key,
        specializeKeyboardShortcutModifiers(event.modifiers, keyboardEntries.values()),
      )
      return [{ phase: 'down', chord, timestamp }]
    }

    if (keyboardEntries.has(key))
      return []

    const chord = pressKeyboardShortcutChord(keyboardEntries, key, key, event.modifiers)
    const events: ShortcutRecordEvent[] = [{ phase: 'down', chord, timestamp }]

    if (fnDown && isKeyboardModifierCode(key)) {
      const fnModifierChord = createFnChord()
      fnModifierChords.set(key, fnModifierChord)
      events.push({ phase: 'down', chord: fnModifierChord, timestamp })
    }

    return events
  }

  const handleUp = (event: KeyboardInputEvent): ShortcutRecordEvent[] => {
    const { key, timestamp } = event

    if (key === 'Fn') {
      if (!fnDown)
        return []

      fnDown = false

      const chords = [
        ...Array.from(fnEntries.values(), entry => entry.chord),
        ...fnModifierChords.values(),
        ...(fnChord
          ? [fnChord]
          : []),
      ]
      fnEntries.clear()
      fnModifierChords.clear()
      fnChord = null
      return chords.map((chord): ShortcutRecordEvent => ({ phase: 'up', chord, timestamp }))
    }

    if (isKeyboardPlainCode(key) && fnEntries.has(key)) {
      return releaseFnShortcutChords(fnEntries, key)
        .map((chord): ShortcutRecordEvent => ({ phase: 'up', chord, timestamp }))
    }

    const releasedKeyboardChords = releaseActiveKeyboardChords(keyboardEntries, key, event.modifiers)
    const releasedFnChords = isKeyboardModifierCode(key)
      ? releaseFnModifierChords()
      : []

    return [...releasedFnChords, ...releasedKeyboardChords]
      .map((chord): ShortcutRecordEvent => ({ phase: 'up', chord, timestamp }))
  }

  /** 只有 Fn 已经按住且后端确认该键属于 Fn 组合时才走 fn 路径；修饰键永远是 keyboard 成员 */
  const isFnComboKey = (key: KeyboardCode, event: KeyboardInputEvent): key is KeyboardPlainCode => (
    fnDown && event.fn && isKeyboardPlainCode(key)
  )

  /** 以固定物理键顺序收敛当前按住的修饰键，作为 Fn chord 的修饰键 */
  const getHeldFnModifiers = (): KeyboardModifierCode[] => {
    const held = getActiveKeyboardModifierCodes(keyboardEntries.values())

    return KEYBOARD_MODIFIER_CODES.filter(code => held.has(code))
  }

  /** 裸 Fn 复用同一个常量，避免为没有修饰键的 chord 多出一个空 modifiers 字段 */
  const createFnChord = (): FnShortcutChord => {
    const modifiers = getHeldFnModifiers()

    return modifiers.length
      ? { source: 'fn', key: 'Fn', modifiers }
      : FN_CHORD
  }

  /**
   * 修饰键松开后结束不再被完整按住的 Fn 修饰键 chord
   *
   * 带侧别的成员按物理键判断，与 keyboard chord 一致：`fn + Left ⌘` 在 Left ⌘ 松开时结束，
   * 即便 Right ⌘ 仍按住；只有补不出侧别的逻辑家族才按「任一侧仍按住」判断
   */
  const releaseFnModifierChords = (): FnShortcutChord[] => {
    if (!fnDown)
      return []

    const held = getHeldFnModifiers()
    const heldFamilies = new Set(held.map(code => KEYBOARD_MODIFIER_BY_CODE[code]!))
    const isStillHeld = (chord: FnShortcutChord): boolean => (
      (chord.modifiers ?? []).every(modifier => (
        isKeyboardModifierCode(modifier)
          ? held.includes(modifier)
          : heldFamilies.has(normalizeShortcutModifier(modifier))
      ))
    )
    const released: FnShortcutChord[] = []

    for (const [code, chord] of fnModifierChords) {
      if (isStillHeld(chord))
        continue

      fnModifierChords.delete(code)
      released.push(chord)
    }

    if (fnChord && !isStillHeld(fnChord)) {
      released.push(fnChord)
      fnChord = null
    }

    /** 与 keyboard 路径一样先结束更完整的组合 */
    return released.sort((a, b) => (b.modifiers?.length ?? 0) - (a.modifiers?.length ?? 0))
  }

  const reset = (): void => {
    keyboardEntries.clear()
    fnEntries.clear()
    fnModifierChords.clear()
    fnChord = null
    fnDown = false
  }

  return {
    handle,
    reset,
    getActivePhysicalModifiers: () => getActiveKeyboardModifierCodes(keyboardEntries.values()),
    get isFnDown() {
      return fnDown
    },
  }
}

export type KeyboardInputTracker = {
  /** 消费一条原始输入，返回由它产生的 chord 事件；reset 只清状态不产出事件 */
  handle: (input: KeyboardInput) => ShortcutRecordEvent[]
  /** 清空全部物理按键状态 */
  reset: () => void
  /** 当前仍按住的物理修饰键 */
  getActivePhysicalModifiers: () => Set<KeyboardModifierCode>
  /** Fn 是否按住 */
  readonly isFnDown: boolean
}

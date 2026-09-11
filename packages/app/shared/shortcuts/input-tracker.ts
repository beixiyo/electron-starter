/** 原始物理输入 → chord 事件：所有捕获后端共用的按键状态合成器 */

import type {
  ActiveKeyboardShortcutEntry,
  FnComboKey,
  FnShortcutChord,
  KeyboardCode,
  KeyboardInput,
  KeyboardInputEvent,
  KeyboardModifierCode,
  ShortcutRecordEvent,
} from './types'
import {
  getActiveKeyboardModifierCodes,
  isKeyboardLockCode,
  isKeyboardModifierCode,
  pressKeyboardShortcutChord,
  releaseActiveKeyboardChords,
} from './utils'

const FN_CHORD: FnShortcutChord = { source: 'fn', key: 'Fn' }

/**
 * 创建键盘输入 tracker
 *
 * 输入是各后端归一后的 {@link KeyboardInput}，输出是录制状态机与手势状态机共同消费的
 * {@link ShortcutRecordEvent}。chord 在 keydown 时冻结：普通键带上此刻按住的物理修饰键，
 * Fn 组合键带上逻辑修饰键；任一成员松开时结束依赖它的全部 chord，Fn 松开则按 down 顺序
 * 结束所有 Fn 组合。修饰键自身永远走 keyboard 路径，即便此时 Fn 按住
 *
 * 系统重复按下由后端过滤，这里再用「已按住即忽略」兜底一次；锁定键不参与任何 chord
 */
export function createKeyboardInputTracker(): KeyboardInputTracker {
  const keyboardEntries = new Map<KeyboardCode, ActiveKeyboardShortcutEntry>()
  const fnEntries = new Map<KeyboardCode, FnShortcutChord>()
  let fnDown = false

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
      return [{ phase: 'down', chord: FN_CHORD, timestamp }]
    }

    if (isFnComboKey(key, event)) {
      if (fnEntries.has(key))
        return []

      const chord: FnShortcutChord = { source: 'fn', key, modifiers: event.modifiers }
      fnEntries.set(key, chord)
      return [{ phase: 'down', chord, timestamp }]
    }

    if (keyboardEntries.has(key))
      return []

    const chord = pressKeyboardShortcutChord(keyboardEntries, key, key, event.modifiers)
    return [{ phase: 'down', chord, timestamp }]
  }

  const handleUp = (event: KeyboardInputEvent): ShortcutRecordEvent[] => {
    const { key, timestamp } = event

    if (key === 'Fn') {
      if (!fnDown)
        return []

      fnDown = false

      const events = Array.from(fnEntries.values())
        .map((chord): ShortcutRecordEvent => ({ phase: 'up', chord, timestamp }))
      fnEntries.clear()
      events.push({ phase: 'up', chord: FN_CHORD, timestamp })
      return events
    }

    const fnChord = isKeyboardModifierCode(key)
      ? undefined
      : fnEntries.get(key)
    if (fnChord) {
      fnEntries.delete(key)
      return [{ phase: 'up', chord: fnChord, timestamp }]
    }

    return releaseActiveKeyboardChords(keyboardEntries, key, event.modifiers)
      .map((chord): ShortcutRecordEvent => ({ phase: 'up', chord, timestamp }))
  }

  /** 只有 Fn 已经按住且后端确认该键属于 Fn 组合时才走 fn 路径；修饰键永远是 keyboard 成员 */
  const isFnComboKey = (key: KeyboardCode, event: KeyboardInputEvent): key is FnComboKey => (
    fnDown && event.fn && !isKeyboardModifierCode(key)
  )

  const reset = (): void => {
    keyboardEntries.clear()
    fnEntries.clear()
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

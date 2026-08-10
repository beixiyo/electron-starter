import type {
  ShortcutBinding,
  ShortcutRecordEvent,
  ShortcutRuntimeEvent,
} from './types'
import { isKeyboardModifierChordPrefixOf, shortcutChordsEqual } from './utils'

const DEFAULT_DOUBLE_PRESS_INTERVAL_MS = 300
const DEFAULT_HOLD_MIN_DURATION_MS = 300

/** 创建统一快捷键手势状态机，消费按下、松开和完整按压录制事件，并派发运行时触发或释放事件 */
export function createShortcutGestureEngine<T extends ShortcutBinding>(
  options: CreateShortcutGestureEngineOptions<T>,
): ShortcutGestureEngine<T> {
  const {
    emit,
    isPaused = () => false,
  } = options

  let entries = options.entries
  const activeIds = new Set<string>()
  /** 保存手势开始时的注册项，确保配置热更新或卸载后仍能正确释放长按 */
  const activeEntries = new Map<string, ShortcutGestureRuntimeEntry<T>>()
  const triggeredHoldIds = new Set<string>()
  const holdTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const doublePressTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const lastPressTimes = new Map<string, number>()
  const pendingPressTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const handle = (event: ShortcutRecordEvent): boolean => {
    if (isPaused()) {
      cancelActiveGestures()
      return false
    }

    switch (event.phase) {
      case 'down':
        return handleDown(event)
      case 'up':
        return handleUp(event)
      case 'press':
        return handlePress(event)
    }
  }

  const updateEntries = (nextEntries: ShortcutGestureRuntimeEntry<T>[]): void => {
    cancelActiveGestures()
    entries = nextEntries
  }

  const handleDown = (event: ShortcutRecordEvent): boolean => {
    for (const entry of entries) {
      if (isKeyboardModifierChordPrefixOf(entry.binding.chord, event.chord))
        cancelChord(entry.binding.chord)
    }

    const matched = findMatchingEntries(entries, event)
    if (matched.length === 0)
      return false

    let started = false
    for (const entry of matched) {
      if (activeIds.has(entry.id))
        continue
      if (entry.canStart && !entry.canStart())
        continue

      activeIds.add(entry.id)
      activeEntries.set(entry.id, entry)
      triggerDown(entry)
      started = true
    }

    return started
  }

  const handleUp = (event: ShortcutRecordEvent): boolean => {
    let handled = false
    const completedEntries: ShortcutGestureRuntimeEntry<T>[] = []
    let holdTriggered = false

    for (const [id, entry] of activeEntries) {
      if (!shortcutChordsEqual(entry.binding.chord, event.chord))
        continue

      activeIds.delete(id)
      activeEntries.delete(id)
      clearHoldTimer(id)

      if (triggeredHoldIds.has(id)) {
        triggeredHoldIds.delete(id)
        holdTriggered = true
        emitShortcut(entry, 'release', 'hold')
      }

      completedEntries.push(entry)

      handled = true
    }

    if (!holdTriggered)
      triggerCompletedPress(completedEntries, event.timestamp)

    return handled
  }

  const handlePress = (event: ShortcutRecordEvent): boolean => {
    const matched = findMatchingEntries(entries, event)
    if (matched.length === 0)
      return false

    const accepted = matched.filter(entry => !entry.canStart || entry.canStart())
    if (accepted.length === 0)
      return false

    triggerCompletedPress(accepted, event.timestamp)

    return true
  }

  const triggerDown = (entry: ShortcutGestureRuntimeEntry<T>): void => {
    switch (entry.binding.gesture) {
      case 'press':
      case 'doublePress':
        return

      case 'hold':
        triggerHold(entry)
    }
  }

  const triggerCompletedPress = (
    completedEntries: ShortcutGestureRuntimeEntry<T>[],
    timestamp: number,
  ): void => {
    const pressEntries = completedEntries.filter(entry => entry.binding.gesture === 'press')
    const doubleEntries = completedEntries.filter(entry => entry.binding.gesture === 'doublePress')

    if (doubleEntries.length === 0) {
      for (const entry of pressEntries)
        emitShortcut(entry, 'trigger', 'press')
      return
    }

    const chordId = getShortcutChordId(doubleEntries[0].binding.chord)
    let triggeredDouble = false
    for (const entry of doubleEntries) {
      if (triggerDoublePress(entry, timestamp))
        triggeredDouble = true
    }
    if (triggeredDouble) {
      clearPendingPressTimer(chordId)
      return
    }

    if (pressEntries.length === 0)
      return

    clearPendingPressTimer(chordId)
    const intervalMs = Math.max(...doubleEntries.map(entry => (
      entry.binding.intervalMs ?? DEFAULT_DOUBLE_PRESS_INTERVAL_MS
    )))
    pendingPressTimers.set(chordId, setTimeout(() => {
      pendingPressTimers.delete(chordId)
      if (isPaused())
        return
      for (const entry of pressEntries)
        emitShortcut(entry, 'trigger', 'press')
    }, intervalMs))
  }

  const triggerDoublePress = (entry: ShortcutGestureRuntimeEntry<T>, timestamp: number): boolean => {
    const { id, binding } = entry
    const intervalMs = binding.intervalMs ?? DEFAULT_DOUBLE_PRESS_INTERVAL_MS
    const last = lastPressTimes.get(id) ?? 0
    const existingTimer = doublePressTimers.get(id)
    const isDoublePress = existingTimer !== undefined && timestamp - last <= intervalMs

    if (isDoublePress) {
      clearTimeout(existingTimer)
      doublePressTimers.delete(id)
      lastPressTimes.delete(id)
      emitShortcut(entry, 'trigger', 'doublePress')
      return true
    }

    if (existingTimer)
      clearTimeout(existingTimer)

    lastPressTimes.set(id, timestamp)
    doublePressTimers.set(
      id,
      setTimeout(() => {
        doublePressTimers.delete(id)
        lastPressTimes.delete(id)
      }, intervalMs),
    )
    return false
  }

  const triggerHold = (entry: ShortcutGestureRuntimeEntry<T>): void => {
    const { id, binding } = entry
    const minDurationMs = binding.minDurationMs ?? DEFAULT_HOLD_MIN_DURATION_MS
    clearHoldTimer(id)

    holdTimers.set(
      id,
      setTimeout(() => {
        holdTimers.delete(id)
        if (!activeIds.has(id) || isPaused())
          return

        triggeredHoldIds.add(id)
        emitShortcut(entry, 'trigger', 'hold')
      }, minDurationMs),
    )
  }

  const emitShortcut = (
    entry: ShortcutGestureRuntimeEntry<T>,
    phase: ShortcutRuntimeEvent['phase'],
    gesture: ShortcutRuntimeEvent['gesture'],
  ): void => {
    emit({
      id: entry.id,
      phase,
      gesture,
      binding: entry.binding,
    })
  }

  const clearHoldTimer = (id: string): void => {
    const timer = holdTimers.get(id)
    if (!timer)
      return

    clearTimeout(timer)
    holdTimers.delete(id)
  }

  const clearDoublePressTimer = (id: string): void => {
    const timer = doublePressTimers.get(id)
    if (timer)
      clearTimeout(timer)
    doublePressTimers.delete(id)
  }

  const clearPendingPressTimer = (chordId: string): void => {
    const timer = pendingPressTimers.get(chordId)
    if (timer)
      clearTimeout(timer)
    pendingPressTimers.delete(chordId)
  }

  const clear = (): void => {
    holdTimers.forEach(clearTimeout)
    doublePressTimers.forEach(clearTimeout)
    pendingPressTimers.forEach(clearTimeout)
    holdTimers.clear()
    doublePressTimers.clear()
    pendingPressTimers.clear()
    lastPressTimes.clear()
    activeIds.clear()
    activeEntries.clear()
    triggeredHoldIds.clear()
  }

  /**
   * 取消当前输入生命周期，并释放已经触发的 hold
   *
   * 浏览器窗口失焦、可见性变化、运行时重载和卸载都可能发生在按键松开之前；
   * 若静默清理状态，主进程会永久保留正在执行的长按动作
   */
  const cancelActiveGestures = (): void => {
    const triggeredEntries = Array.from(triggeredHoldIds)
      .map(id => activeEntries.get(id))
      .filter((entry): entry is ShortcutGestureRuntimeEntry<T> => !!entry)

    clear()

    for (const entry of triggeredEntries)
      emitShortcut(entry, 'release', 'hold')
  }

  /** 取消指定 chord 的手势状态；Fn 组合键开始时用于撤销 Fn 单键候选 */
  const cancelChord = (chord: ShortcutBinding['chord']): void => {
    clearPendingPressTimer(getShortcutChordId(chord))
    const matchingIds = entries
      .filter(entry => shortcutChordsEqual(entry.binding.chord, chord))
      .map(entry => entry.id)

    for (const id of matchingIds) {
      const activeEntry = activeEntries.get(id)
      clearHoldTimer(id)
      clearDoublePressTimer(id)
      lastPressTimes.delete(id)
      activeIds.delete(id)
      activeEntries.delete(id)

      if (triggeredHoldIds.delete(id) && activeEntry)
        emitShortcut(activeEntry, 'release', 'hold')
    }
  }

  return {
    handle,
    updateEntries,
    clear,
    cancelActiveGestures,
    cancelChord,
    dispose: cancelActiveGestures,
  }
}

function getShortcutChordId(chord: ShortcutBinding['chord']): string {
  return `${chord.source}:${chord.key}:${[...(chord.modifiers ?? [])].sort().join('+')}`
}

function findMatchingEntries<T extends ShortcutBinding>(
  entries: ShortcutGestureRuntimeEntry<T>[],
  event: ShortcutRecordEvent,
): ShortcutGestureRuntimeEntry<T>[] {
  return entries.filter(entry => shortcutChordsEqual(entry.binding.chord, event.chord))
}

/** 可被统一手势状态机管理的快捷键注册项 */
export type ShortcutGestureRuntimeEntry<T extends ShortcutBinding = ShortcutBinding> = {
  /** 动作标识，用于隔离每个绑定的运行时状态 */
  id: string
  /** 已持久化并完成能力过滤的 binding */
  binding: T
  /** 返回 false 时本次输入不进入手势状态机 */
  canStart?: () => boolean
}

export type CreateShortcutGestureEngineOptions<T extends ShortcutBinding = ShortcutBinding> = {
  /** 当前捕获后端需要管理的快捷键注册项 */
  entries: ShortcutGestureRuntimeEntry<T>[]
  /** 录制或外部暂停期间返回 true，会清理内部按键状态并忽略本次事件 */
  isPaused?: () => boolean
  /** 派发统一运行时事件 */
  emit: (event: ShortcutRuntimeEvent & { binding: T }) => void
}

export type ShortcutGestureEngine<T extends ShortcutBinding = ShortcutBinding> = {
  /** 消费一个后端标准化后的按键事件；返回 true 表示命中快捷键 */
  handle: (event: ShortcutRecordEvent) => boolean
  /** 替换注册项，并清理旧按键状态 */
  updateEntries: (entries: ShortcutGestureRuntimeEntry<T>[]) => void
  /** 清理 timer 和按键状态 */
  clear: () => void
  /** 取消当前输入生命周期，并为已触发的长按派发释放事件 */
  cancelActiveGestures: () => void
  /** 取消指定 chord 的 active、hold 和 doublePress 候选状态 */
  cancelChord: (chord: ShortcutBinding['chord']) => void
  /** 释放引擎内部状态 */
  dispose: () => void
}

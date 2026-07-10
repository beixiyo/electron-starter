import type {
  ShortcutBinding,
  ShortcutRecordEvent,
  ShortcutRuntimeEvent,
} from './types'
import { shortcutChordsEqual } from './utils'

const DEFAULT_DOUBLE_PRESS_INTERVAL_MS = 300
const DEFAULT_HOLD_MIN_DURATION_MS = 300

/** 创建统一快捷键手势状态机，消费 down/up/press 录制事件并派发 runtime trigger/release */
export function createShortcutGestureEngine<T extends ShortcutBinding>(
  options: CreateShortcutGestureEngineOptions<T>,
): ShortcutGestureEngine<T> {
  const {
    emit,
    isPaused = () => false,
  } = options

  let entries = options.entries
  const activeIds = new Set<string>()
  const triggeredHoldIds = new Set<string>()
  const holdTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const doublePressTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const lastPressTimes = new Map<string, number>()

  const handle = (event: ShortcutRecordEvent): boolean => {
    if (isPaused()) {
      clear()
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
    entries = nextEntries
    clear()
  }

  const handleDown = (event: ShortcutRecordEvent): boolean => {
    const matched = findMatchingEntries(entries, event)
    if (matched.length === 0)
      return false

    for (const entry of matched) {
      if (activeIds.has(entry.id))
        continue
      if (entry.canStart && !entry.canStart())
        continue

      activeIds.add(entry.id)
      triggerDown(entry, event.timestamp)
    }

    return true
  }

  const handleUp = (event: ShortcutRecordEvent): boolean => {
    let handled = false

    for (const entry of entries) {
      if (!activeIds.has(entry.id))
        continue
      if (!shortcutChordsEqual(entry.binding.chord, event.chord))
        continue

      activeIds.delete(entry.id)
      clearHoldTimer(entry.id)

      if (triggeredHoldIds.has(entry.id)) {
        triggeredHoldIds.delete(entry.id)
        emitShortcut(entry, 'release', 'hold')
      }

      handled = true
    }

    return handled
  }

  const handlePress = (event: ShortcutRecordEvent): boolean => {
    const matched = findMatchingEntries(entries, event)
    if (matched.length === 0)
      return false

    for (const entry of matched) {
      if (entry.canStart && !entry.canStart())
        continue

      if (entry.binding.gesture === 'press') {
        emitShortcut(entry, 'trigger', 'press')
      }
      else if (entry.binding.gesture === 'doublePress') {
        triggerDoublePress(entry, event.timestamp)
      }
    }

    return true
  }

  const triggerDown = (entry: ShortcutGestureRuntimeEntry<T>, timestamp: number): void => {
    switch (entry.binding.gesture) {
      case 'press':
        emitShortcut(entry, 'trigger', 'press')
        return

      case 'doublePress':
        triggerDoublePress(entry, timestamp)
        return

      case 'hold':
        triggerHold(entry)
    }
  }

  const triggerDoublePress = (entry: ShortcutGestureRuntimeEntry<T>, timestamp: number): void => {
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
      return
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

  const clear = (): void => {
    holdTimers.forEach(clearTimeout)
    doublePressTimers.forEach(clearTimeout)
    holdTimers.clear()
    doublePressTimers.clear()
    lastPressTimes.clear()
    activeIds.clear()
    triggeredHoldIds.clear()
  }

  return {
    handle,
    updateEntries,
    clear,
    dispose: clear,
  }
}

function findMatchingEntries<T extends ShortcutBinding>(
  entries: ShortcutGestureRuntimeEntry<T>[],
  event: ShortcutRecordEvent,
): ShortcutGestureRuntimeEntry<T>[] {
  return entries.filter(entry => shortcutChordsEqual(entry.binding.chord, event.chord))
}

/** 可被统一手势状态机管理的快捷键注册项 */
export type ShortcutGestureRuntimeEntry<T extends ShortcutBinding = ShortcutBinding> = {
  /** action id，用于隔离每个绑定的 runtime 状态 */
  id: string
  /** 已持久化并完成能力过滤的 binding */
  binding: T
  /** 返回 false 时本次输入不进入手势状态机 */
  canStart?: () => boolean
}

export type CreateShortcutGestureEngineOptions<T extends ShortcutBinding = ShortcutBinding> = {
  /** 当前 backend 需要管理的快捷键注册项 */
  entries: ShortcutGestureRuntimeEntry<T>[]
  /** 录制或外部暂停期间返回 true，会清理内部按键状态并忽略本次事件 */
  isPaused?: () => boolean
  /** 派发统一 runtime 事件 */
  emit: (event: ShortcutRuntimeEvent & { binding: T }) => void
}

export type ShortcutGestureEngine<T extends ShortcutBinding = ShortcutBinding> = {
  /** 消费一个后端标准化后的按键事件；返回 true 表示命中快捷键 */
  handle: (event: ShortcutRecordEvent) => boolean
  /** 替换注册项，并清理旧按键状态 */
  updateEntries: (entries: ShortcutGestureRuntimeEntry<T>[]) => void
  /** 清理 timer 和按键状态 */
  clear: () => void
  /** 释放引擎内部状态 */
  dispose: () => void
}

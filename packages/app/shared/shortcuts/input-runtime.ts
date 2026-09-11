/** 原始输入 → 手势触发：tracker 与手势状态机的组合，主进程系统级后端与渲染进程 DOM 后端共用 */

import type { ShortcutGestureRuntimeEntry } from './gesture-engine'
import { createShortcutGestureEngine } from './gesture-engine'
import { createKeyboardInputTracker } from './input-tracker'
import type { KeyboardInput, KeyboardInputEvent, ShortcutBinding, ShortcutRuntimeEvent } from './types'
import { keyboardShortcutChordMatchesModifierState } from './utils'

/**
 * 创建快捷键输入运行时
 *
 * 每条原始输入先经 tracker 合成 chord 事件，再交给手势状态机；同时用当前物理与逻辑
 * 修饰键状态校验每个 keyboard 注册项，偏离绑定的候选立即撤销并释放已触发的 hold
 * 暂停或后端 reset 时清空全部状态，已触发的 hold 会补发 release
 */
export function createShortcutInputRuntime<T extends ShortcutBinding>(
  options: CreateShortcutInputRuntimeOptions<T>,
): ShortcutInputRuntime<T> {
  const { emit, isPaused = () => false } = options
  let entries = options.entries

  const tracker = createKeyboardInputTracker()
  const engine = createShortcutGestureEngine<T>({ entries, isPaused, emit })

  const handle = (input: KeyboardInput): boolean => {
    if (isPaused() || input.phase === 'reset') {
      cancel()
      return false
    }

    const recordEvents = tracker.handle(input)
    if (recordEvents.length === 0)
      return false

    if (input.phase === 'down')
      reconcileModifierState(input)

    let handled = false
    for (const recordEvent of recordEvents)
      handled = engine.handle(recordEvent) || handled

    if (input.phase === 'up')
      reconcileModifierState(input)

    return handled
  }

  /** 修饰键状态偏离绑定时取消该 chord 的候选，并释放已经触发的 hold */
  const reconcileModifierState = (event: KeyboardInputEvent): void => {
    const activePhysicalModifiers = tracker.getActivePhysicalModifiers()

    for (const entry of entries) {
      const { chord } = entry.binding
      if (chord.source !== 'keyboard')
        continue

      if (!keyboardShortcutChordMatchesModifierState(chord, activePhysicalModifiers, event.modifiers))
        engine.cancelChord(chord)
    }
  }

  /**
   * 替换注册项时物理按键状态也要一起清
   *
   * 重载往往发生在按键仍按住时（权限变化、配置保存）；只清手势不清 tracker 的话，
   * 松开前那个键会一直被当成「已按住」，下一次按下被当成重复而丢弃
   */
  const updateEntries = (nextEntries: ShortcutGestureRuntimeEntry<T>[]): void => {
    entries = nextEntries
    engine.updateEntries(nextEntries)
    tracker.reset()
  }

  const cancel = (): void => {
    engine.cancelActiveGestures()
    tracker.reset()
  }

  return {
    handle,
    updateEntries,
    cancel,
    dispose: cancel,
  }
}

export type CreateShortcutInputRuntimeOptions<T extends ShortcutBinding = ShortcutBinding> = {
  /** 当前后端需要管理的快捷键注册项 */
  entries: ShortcutGestureRuntimeEntry<T>[]
  /** 录制或外部暂停期间返回 true，会清空按键状态并忽略本次输入 */
  isPaused?: () => boolean
  /** 派发统一运行时事件 */
  emit: (event: ShortcutRuntimeEvent & { binding: T }) => void
}

export type ShortcutInputRuntime<T extends ShortcutBinding = ShortcutBinding> = {
  /** 消费一条原始输入；返回 true 表示命中了某个快捷键 */
  handle: (input: KeyboardInput) => boolean
  /** 替换注册项，并清理旧按键与手势状态 */
  updateEntries: (entries: ShortcutGestureRuntimeEntry<T>[]) => void
  /** 取消当前输入生命周期，为已触发的 hold 派发 release */
  cancel: () => void
  /** 释放内部状态 */
  dispose: () => void
}

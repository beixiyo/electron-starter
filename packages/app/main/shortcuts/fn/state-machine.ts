/**
 * Fn 键快捷键状态机
 *
 * 状态流转：
 *   IDLE → DECIDING(300ms) → HOLD_ACTIVE
 *                           ↘ WAIT_DOUBLE → DOUBLE_DONE / IDLE
 *   DECIDING + FN_COMBO_* → 触发 combo → IDLE
 *
 * hold / doublePress / combos 三者互斥，由 300ms 决策窗口自动裁决。
 *
 * combo 键由 Swift 二进制在 HID 层检测（FN_COMBO_Space 等），
 * 彻底避免 IOHIDManager 与 uIOhook 的跨事件源时序问题。
 */

import type { FnModifier } from '@ipc/services/fn/contract'
import type { BrowserWindow } from 'electron'
import type { FnShortcutComboConfig, FnShortcutsConfig } from './types'
import { sendFnComboEvent, sendFnDownEvent, sendFnUpEvent } from '@ipc/services/fn/service'
import { FN_DOUBLE_PRESS_INTERVAL_MS } from '@shared'
import { addFnComboListener, addFnKeyListener } from './core'

const DECIDING_MS = FN_DOUBLE_PRESS_INTERVAL_MS

type State
  = | 'IDLE'
    | 'DECIDING'
    | 'HOLD_PENDING'
    | 'WAIT_DOUBLE'
    | 'HOLD_ACTIVE'
    | 'DOUBLE_DONE'

/** IPC 转发监听器，不随快捷键重注册而清除；仅在 setupFnKeyIpc 重绑定窗口或 app 退出时清除 */
const ipcCleanupFns: Array<() => void> = []

/** 快捷键业务监听器，重新注册时先清除 */
const shortcutCleanupFns: Array<() => void> = []

/** 录制快捷键期间暂停所有 action 触发 */
let suspended = false

export function isSuspended(): boolean { return suspended }

export function suspendFnShortcuts(): void {
  suspended = true
}

export function resumeFnShortcuts(): void {
  suspended = false
}

export function registerFnShortcuts(config: FnShortcutsConfig): void {
  const { hold, doublePress, combos = [] } = config
  if (!hold && !doublePress && combos.length === 0)
    return

  let state: State = 'IDLE'
  let decidingTimer: ReturnType<typeof setTimeout> | null = null
  let waitDoubleTimer: ReturnType<typeof setTimeout> | null = null
  let decidingStartTime = 0
  const comboLastPressTime = new Map<string, number>()
  const comboDoublePressTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const clearTimers = () => {
    if (decidingTimer) {
      clearTimeout(decidingTimer)
      decidingTimer = null
    }
    if (waitDoubleTimer) {
      clearTimeout(waitDoubleTimer)
      waitDoubleTimer = null
    }
  }

  const clearComboDoublePressTimers = () => {
    comboDoublePressTimers.forEach(clearTimeout)
    comboDoublePressTimers.clear()
    comboLastPressTime.clear()
  }

  const triggerCombo = (combo: FnShortcutComboConfig) => {
    if (combo.gesture !== 'doublePress') {
      combo.onTrigger()
      return
    }

    const intervalMs = combo.intervalMs ?? DECIDING_MS
    const chordId = getComboChordId(combo.key, combo.modifiers ?? [])
    const now = Date.now()
    const last = comboLastPressTime.get(chordId) ?? 0
    const existingTimer = comboDoublePressTimers.get(chordId)
    const isDoublePress = existingTimer !== undefined && now - last <= intervalMs

    if (isDoublePress) {
      clearTimeout(existingTimer)
      comboDoublePressTimers.delete(chordId)
      comboLastPressTime.delete(chordId)
      combo.onTrigger()
      return
    }

    if (existingTimer)
      clearTimeout(existingTimer)

    comboLastPressTime.set(chordId, now)
    comboDoublePressTimers.set(
      chordId,
      setTimeout(() => {
        comboDoublePressTimers.delete(chordId)
        comboLastPressTime.delete(chordId)
      }, intervalMs),
    )
  }

  if (combos.length > 0) {
    const unsubCombo = addFnComboListener(({ key, modifiers }) => {
      if (state !== 'DECIDING')
        return

      const matched = combos.find(c =>
        c.key === key && modifiersMatch(c.modifiers ?? [], modifiers))
      if (!matched)
        return

      clearTimers()
      if (!suspended)
        triggerCombo(matched)
      state = 'IDLE'
    })
    shortcutCleanupFns.push(unsubCombo)
  }

  const enterHoldActive = async () => {
    if (suspended) {
      state = 'IDLE'
      return
    }

    if (hold) {
      state = 'HOLD_PENDING'

      if (hold.canStart && !(await hold.canStart())) {
        state = 'IDLE'
        return
      }

      if (state !== 'HOLD_PENDING') {
        return
      }

      state = 'HOLD_ACTIVE'

      hold.onStart()
      return
    }

    state = 'HOLD_ACTIVE'
  }

  const exitHoldActive = () => hold?.onRelease?.()

  const unsub = addFnKeyListener((event) => {
    if (event === 'down') {
      switch (state) {
        case 'IDLE': {
          state = 'DECIDING'
          decidingStartTime = Date.now()

          decidingTimer = setTimeout(() => {
            decidingTimer = null
            if (state === 'DECIDING') {
              void enterHoldActive()
            }
          }, DECIDING_MS)
          break
        }

        case 'WAIT_DOUBLE': {
          clearTimers()
          state = 'DOUBLE_DONE'
          if (!suspended) {
            doublePress?.onTrigger()
          }
          break
        }
      }
    }
    else {
      switch (state) {
        case 'DECIDING': {
          clearTimers()

          if (doublePress) {
            const elapsed = Date.now() - decidingStartTime
            const remaining = Math.max(DECIDING_MS - elapsed, 0)

            if (remaining > 0) {
              state = 'WAIT_DOUBLE'
              waitDoubleTimer = setTimeout(() => {
                waitDoubleTimer = null
                if (state === 'WAIT_DOUBLE') {
                  state = 'IDLE'
                }
              }, remaining)
            }
            else {
              state = 'IDLE'
            }
          }
          else {
            state = 'IDLE'
          }
          break
        }

        case 'HOLD_PENDING': {
          state = 'IDLE'
          break
        }

        case 'HOLD_ACTIVE': {
          exitHoldActive()
          state = 'IDLE'
          break
        }

        case 'DOUBLE_DONE': {
          state = 'IDLE'
          break
        }
      }
    }
  })

  shortcutCleanupFns.push(unsub, clearTimers, clearComboDoublePressTimers)
}

export function setupFnKeyIpc(mainWindow: BrowserWindow): void {
  /**
   * 主窗口重建（macOS activate）时会再次调用：
   * 先清掉指向旧窗口的转发监听器，避免随重建次数累积
   */
  const cleanedCount = ipcCleanupFns.length
  for (const fn of ipcCleanupFns) fn()
  ipcCleanupFns.length = 0

  console.log(`[fn] setupFnKeyIpc: cleaned ${cleanedCount} stale listener(s)`)

  const unsubKey = addFnKeyListener((event) => {
    if (mainWindow.isDestroyed()) {
      return
    }

    if (event === 'down')
      sendFnDownEvent(mainWindow)
    else
      sendFnUpEvent(mainWindow)
  })

  const unsubCombo = addFnComboListener(({ key, modifiers }) => {
    if (!mainWindow.isDestroyed())
      sendFnComboEvent(mainWindow, key, modifiers)
  })

  ipcCleanupFns.push(unsubKey, unsubCombo)
}

/** 仅清除快捷键业务监听器，用于重新注册时 */
export function resetShortcutHandlers(): void {
  for (const fn of shortcutCleanupFns) fn()
  shortcutCleanupFns.length = 0
}

/** 清除全部监听器（app 退出时调用） */
export function resetFnShortcutStates(): void {
  resetShortcutHandlers()
  for (const fn of ipcCleanupFns) fn()
  ipcCleanupFns.length = 0
}

function modifiersMatch(a: FnModifier[], b: FnModifier[]): boolean {
  if (a.length !== b.length)
    return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((m, i) => m === sb[i])
}

function getComboChordId(key: string, modifiers: FnModifier[]): string {
  return `${[...modifiers].sort().join('+')}+${key}`
}

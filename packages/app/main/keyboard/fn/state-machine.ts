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

import type { Modifier } from '@ipc/services/fn/contract'
import type { FnShortcutsConfig } from '@shared'
import type { BrowserWindow } from 'electron'
import { sendFnComboEvent, sendFnDownEvent, sendFnUpEvent } from '@ipc/services/fn/service'
import { sendHoldEndEvent, sendHoldStartEvent } from '@ipc/services/hold/service'
import { FN_DOUBLE_PRESS_INTERVAL_MS } from '@shared'
import { logError } from '../../utils/logger'
import { windowManager } from '../../window-manager'
import { holdStateManager } from '../hold/state-manager'
import { addFnComboListener, addFnKeyListener } from './core'

const DECIDING_MS = FN_DOUBLE_PRESS_INTERVAL_MS

type State
  = | 'IDLE'
    | 'DECIDING'
    | 'WAIT_DOUBLE'
    | 'HOLD_ACTIVE'
    | 'COMBO_DONE'
    | 'DOUBLE_DONE'

/** IPC 转发监听器，生命周期与 app 一致，不随快捷键重注册而清除 */
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

  let state: State = 'IDLE'
  let decidingTimer: ReturnType<typeof setTimeout> | null = null
  let waitDoubleTimer: ReturnType<typeof setTimeout> | null = null
  let decidingStartTime = 0

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
        matched.onTrigger()
      state = 'IDLE'
    })
    shortcutCleanupFns.push(unsubCombo)
  }

  const enterHoldActive = () => {
    if (suspended) {
      state = 'IDLE'
      return
    }

    state = 'HOLD_ACTIVE'

    if (hold) {
      const { windowType, showWindow = true } = hold
      holdStateManager.startHold({
        type: windowType,
        onRelease: hold.onRelease,
        showWindow,
      })
      if (showWindow && windowType) {
        const win = windowManager.get(windowType) || windowManager.create(windowType)
        if (win && !win.isVisible()) {
          win.showInactive()
        }
      }
      sendHoldStartEvent(windowType)
    }
  }

  const exitHoldActive = () => {
    if (hold?.windowType) {
      sendHoldEndEvent(hold.windowType)
    }
  }

  const unsub = addFnKeyListener((event) => {
    if (event === 'down') {
      switch (state) {
        case 'IDLE': {
          state = 'DECIDING'
          decidingStartTime = Date.now()

          decidingTimer = setTimeout(() => {
            decidingTimer = null
            if (state === 'DECIDING') {
              enterHoldActive()
            }
          }, DECIDING_MS)
          break
        }

        case 'WAIT_DOUBLE': {
          clearTimers()
          state = 'DOUBLE_DONE'
          if (!suspended) {
            doublePress?.onTrigger()
            if (doublePress?.windowType) {
              try {
                windowManager.toggle(doublePress.windowType)
              }
              catch (error) {
                logError('double press 切换窗口失败', error, {
                  module: 'fn-shortcuts',
                  operation: 'WAIT_DOUBLE→DOUBLE_DONE',
                })
              }
            }
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

        case 'HOLD_ACTIVE': {
          exitHoldActive()
          state = 'IDLE'
          break
        }

        case 'COMBO_DONE':
        case 'DOUBLE_DONE': {
          state = 'IDLE'
          break
        }
      }
    }
  })

  shortcutCleanupFns.push(unsub, clearTimers)
}

export function setupFnKeyIpc(mainWindow: BrowserWindow): void {
  const unsubKey = addFnKeyListener((event) => {
    if (mainWindow.isDestroyed())
      return

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

function modifiersMatch(a: Modifier[], b: Modifier[]): boolean {
  if (a.length !== b.length)
    return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((m, i) => m === sb[i])
}

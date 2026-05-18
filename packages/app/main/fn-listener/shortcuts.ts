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

import type { FnShortcutsConfig } from '@shared'
import type { BrowserWindow } from 'electron'
import { sendFnDownEvent, sendFnUpEvent } from '@ipc/listeners/fn/events'
import { sendHoldEndEvent, sendHoldStartEvent } from '@ipc/services/window/events'
import { FN_DOUBLE_PRESS_INTERVAL_MS } from '@shared'
import { holdStateManager } from '../hold-state-manager'
import { logError } from '../utils/logger'
import { windowManager } from '../window-manager'
import { addFnComboListener, addFnKeyListener } from './core'

const DECIDING_MS = FN_DOUBLE_PRESS_INTERVAL_MS

type State
  = | 'IDLE'
    | 'DECIDING'
    | 'WAIT_DOUBLE'
    | 'HOLD_ACTIVE'
    | 'COMBO_DONE'
    | 'DOUBLE_DONE'

const cleanupFns: Array<() => void> = []

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
    const unsubCombo = addFnComboListener((key) => {
      if (state !== 'DECIDING')
        return

      const matched = combos.find(c => c.key === key)
      if (!matched)
        return

      clearTimers()
      matched.onTrigger()
      // Swift 已消费 FN_UP（缓冲后未输出），不会再收到 UP 事件，直接回 IDLE
      state = 'IDLE'
    })
    cleanupFns.push(unsubCombo)
  }

  const enterHoldActive = () => {
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

  cleanupFns.push(unsub, clearTimers)
}

export function setupFnKeyIpc(mainWindow: BrowserWindow): void {
  const unsub = addFnKeyListener((event) => {
    if (mainWindow.isDestroyed())
      return

    if (event === 'down')
      sendFnDownEvent(mainWindow)
    else
      sendFnUpEvent(mainWindow)
  })

  cleanupFns.push(unsub)
}

export function resetFnShortcutStates(): void {
  for (const fn of cleanupFns) fn()
  cleanupFns.length = 0
}

import type { WindowType } from '@shared'
import type { HoldGlobalShortcutConfig, HoldShortcutConfig } from '../types'
import { sendHoldEndEvent, sendHoldStartEvent } from '@ipc/services/hold/service'
import { HOLD_MIN_DURATION_MS, HOLD_SHORT_ERROR_MESSAGE, WINDOW_CONFIGS } from '@shared'
import { globalShortcut } from 'electron'
import { holdStateManager } from './state-manager'
import { logError } from '../../utils/logger'
import { windowManager } from '../../window-manager'
import {
  activateHoldReleaseDetector,
  clearHoldReleaseDetectors,
  deactivateHoldReleaseDetector,
  registerHoldReleaseDetector,
  unregisterHoldReleaseDetector,
} from './release-detector'
import { checkAndWarnShortcutConflict, formatShortcutLogInfo } from '../shortcut-utils'

const holdShortcuts = new Map<string, HoldShortcutConfig>()
const activeHoldAccelerators = new Set<string>()

function handleHoldPress(
  accelerator: string,
  windowType: WindowType | undefined,
  onRelease: ((result: unknown) => void) | undefined,
  showWindow: boolean,
  canStart: (() => boolean | Promise<boolean>) | undefined,
): void {
  if (activeHoldAccelerators.has(accelerator)) {
    return
  }

  activeHoldAccelerators.add(accelerator)

  void startHoldPress(accelerator, windowType, onRelease, showWindow, canStart)
}

async function startHoldPress(
  accelerator: string,
  windowType: WindowType | undefined,
  onRelease: ((result: unknown) => void) | undefined,
  showWindow: boolean,
  canStart: (() => boolean | Promise<boolean>) | undefined,
): Promise<void> {
  try {
    if (canStart && !(await canStart())) {
      activeHoldAccelerators.delete(accelerator)
      return
    }

    holdStateManager.startHold({ type: windowType, onRelease, showWindow })

    if (showWindow && windowType) {
      const window = windowManager.get(windowType) || windowManager.create(windowType)
      if (window && !window.isVisible()) {
        const config = WINDOW_CONFIGS[windowType]
        if (config?.focusable) {
          windowManager.show(windowType)
        }
        else {
          windowManager.showInactive(windowType)
        }
      }
    }

    sendHoldStartEvent(windowType)

    try {
      activateHoldReleaseDetector(accelerator, () => {
        handleHoldRelease(accelerator, windowType)
      })
    }
    catch (error) {
      logError('启动 uIOhook 长按检测失败', error, {
        module: 'shortcuts',
        operation: 'handleHoldPress',
        context: { accelerator },
      })
      handleHoldRelease(accelerator, windowType)
    }
  }
  catch (error) {
    logError('长按快捷键处理异常', error, {
      module: 'shortcuts',
      operation: 'handleHoldPress',
      context: { accelerator },
    })
    handleHoldRelease(accelerator, windowType)
  }
}

export function registerHoldGlobalShortcut(config: HoldGlobalShortcutConfig): boolean {
  const { accelerator, windowType, onRelease, showWindow = true, canStart } = config

  try {
    registerHoldReleaseDetector(accelerator)
  }
  catch (error) {
    logError('长按快捷键解析失败', error, {
      module: 'shortcuts',
      operation: 'registerHoldGlobalShortcut',
      context: { accelerator },
    })
    return false
  }

  if (holdShortcuts.has(accelerator)) {
    const existingConfig = holdShortcuts.get(accelerator)
    if (checkAndWarnShortcutConflict(accelerator, existingConfig, '长按快捷键')) {
      unregisterHoldGlobalShortcut(accelerator)
    }
  }

  const success = globalShortcut.register(accelerator, () => {
    handleHoldPress(accelerator, windowType, onRelease, showWindow, canStart)
  })

  if (success) {
    holdShortcuts.set(accelerator, {
      windowType,
      onRelease,
      showWindow,
      canStart,
    })
    const logInfo = formatShortcutLogInfo({
      shortcutType: '长按全局快捷键',
      accelerator,
      windowType,
      showWindow,
      hasCallback: !!onRelease,
      callbackLabel: '回调函数',
    })
    console.log(logInfo)
  }
  else {
    logError('长按全局快捷键注册失败', undefined, {
      module: 'shortcuts',
      operation: 'registerHoldGlobalShortcut',
      context: { accelerator },
    })
    unregisterHoldReleaseDetector(accelerator)
  }

  return success
}

export function unregisterHoldGlobalShortcut(accelerator: string): void {
  deactivateHoldReleaseDetector(accelerator)
  unregisterHoldReleaseDetector(accelerator)
  activeHoldAccelerators.delete(accelerator)

  globalShortcut.unregister(accelerator)
  const config = holdShortcuts.get(accelerator)
  holdShortcuts.delete(accelerator)

  if (config) {
    try {
      const holdState = holdStateManager.getHoldState(config.windowType)
      if (holdState && holdState.isHolding) {
        holdStateManager.endHold({ type: config.windowType })
      }
    }
    catch (error) {
      logError('清理长按状态失败', error, {
        module: 'shortcuts',
        operation: 'unregisterHoldGlobalShortcut',
        context: { accelerator, windowType: config.windowType },
      })
    }
  }

  console.log(`长按全局快捷键已取消注册: ${accelerator}`)
}

export function getHoldShortcutConfig(accelerator: string): HoldShortcutConfig | undefined {
  return holdShortcuts.get(accelerator)
}

/** @internal */
export function getHoldShortcutsMap(): Map<string, HoldShortcutConfig> {
  return holdShortcuts
}

export function resetHoldShortcutStates(): void {
  const acceleratorsToClean = Array.from(activeHoldAccelerators)
  activeHoldAccelerators.clear()

  clearHoldReleaseDetectors()

  for (const config of holdShortcuts.values()) {
    try {
      const holdState = holdStateManager.getHoldState(config.windowType)
      if (holdState && holdState.isHolding) {
        holdStateManager.endHold({ type: config.windowType })
      }
    }
    catch (error) {
      logError('清理长按状态失败', error, {
        module: 'shortcuts',
        operation: 'resetHoldShortcutStates',
        context: { windowType: config.windowType },
      })
    }
  }

  if (acceleratorsToClean.length > 0) {
    console.log(`已清理 ${acceleratorsToClean.length} 个激活的长按快捷键状态`)
  }
}

function handleHoldRelease(accelerator: string, windowType?: WindowType): void {
  if (!activeHoldAccelerators.has(accelerator)) {
    return
  }

  activeHoldAccelerators.delete(accelerator)
  deactivateHoldReleaseDetector(accelerator)

  const holdState = holdStateManager.getHoldState(windowType)
  const holdDuration = holdState
    ? Date.now() - holdState.startTime
    : undefined
  const isShortHold = typeof holdDuration === 'number' && holdDuration < HOLD_MIN_DURATION_MS

  if (isShortHold) {
    holdStateManager.completeHold(windowType, {
      error: HOLD_SHORT_ERROR_MESSAGE,
      duration: Math.max(holdDuration, 0),
    })
  }

  sendHoldEndEvent(windowType)
}

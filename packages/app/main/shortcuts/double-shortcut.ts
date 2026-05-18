import type { DoublePressGlobalShortcutConfig, DoublePressShortcutConfig } from './types'
import { DOUBLE_PRESS_INTERVAL_MS } from '@shared'
import { globalShortcut } from 'electron'
import { logError } from '../utils/logger'
import { windowManager } from '../window-manager'
import { checkAndWarnShortcutConflict, formatShortcutLogInfo } from './shortcut-utils'

const doublePressShortcuts = new Map<string, DoublePressShortcutConfig>()
const lastPressTime = new Map<string, number>()
const singlePressTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * 注册双击全局快捷键
 * 两次按下间隔 ≤ DOUBLE_PRESS_INTERVAL_MS 视为双击
 * @returns 是否注册成功
 */
export function registerDoublePressGlobalShortcut(config: DoublePressGlobalShortcutConfig): boolean {
  const { accelerator, windowType, onFirstPress, onDoublePress } = config

  if (doublePressShortcuts.has(accelerator)) {
    const existingConfig = doublePressShortcuts.get(accelerator)
    if (checkAndWarnShortcutConflict(accelerator, existingConfig, '双击快捷键')) {
      unregisterDoublePressGlobalShortcut(accelerator)
    }
  }

  const success = globalShortcut.register(accelerator, () => {
    const now = Date.now()
    const last = lastPressTime.get(accelerator) ?? 0
    const existingTimer = singlePressTimers.get(accelerator)
    const isDouble = existingTimer !== undefined && now - last <= DOUBLE_PRESS_INTERVAL_MS

    if (isDouble) {
      clearTimeout(existingTimer)
      singlePressTimers.delete(accelerator)
      lastPressTime.delete(accelerator)
      onDoublePress?.()

      if (windowType) {
        try {
          windowManager.toggle(windowType)
        }
        catch (error) {
          logError('切换窗口失败', error, {
            module: 'shortcuts',
            operation: 'registerDoublePressGlobalShortcut',
            context: { accelerator, windowType },
          })
        }
      }
    }
    else {
      if (existingTimer) clearTimeout(existingTimer)
      lastPressTime.set(accelerator, now)
      singlePressTimers.set(
        accelerator,
        setTimeout(() => {
          singlePressTimers.delete(accelerator)
          onFirstPress?.()
        }, DOUBLE_PRESS_INTERVAL_MS),
      )
    }
  })

  if (success) {
    doublePressShortcuts.set(accelerator, { windowType, onFirstPress, onDoublePress })
    const logInfo = formatShortcutLogInfo({
      shortcutType: '双击全局快捷键',
      accelerator,
      windowType,
      hasCallback: !!(onFirstPress || onDoublePress),
      callbackLabel: '回调函数',
    })
    console.log(logInfo)
  }
  else {
    logError(`双击全局快捷键注册失败: ${accelerator}`, undefined, {
      module: 'shortcuts',
      operation: 'registerDoublePressGlobalShortcut',
      context: { accelerator },
    })
  }

  return success
}

/**
 * 取消注册双击全局快捷键
 */
export function unregisterDoublePressGlobalShortcut(accelerator: string): void {
  globalShortcut.unregister(accelerator)
  doublePressShortcuts.delete(accelerator)
  lastPressTime.delete(accelerator)
  const timer = singlePressTimers.get(accelerator)
  if (timer) {
    clearTimeout(timer)
    singlePressTimers.delete(accelerator)
  }
  console.log(`双击全局快捷键已取消注册: ${accelerator}`)
}

/**
 * 获取双击快捷键配置映射表（用于清理）
 * @internal
 */
export function getDoublePressShortcutsMap(): Map<string, DoublePressShortcutConfig> {
  return doublePressShortcuts
}

/**
 * 清理所有双击快捷键状态
 */
export function resetDoublePressShortcutStates(): void {
  singlePressTimers.forEach(clearTimeout)
  singlePressTimers.clear()
  lastPressTime.clear()
  doublePressShortcuts.clear()
}

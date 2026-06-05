import type { GlobalShortcutConfig, ShortcutConfig } from '../types'
import { globalShortcut } from 'electron'
import { logError } from '../../utils/logger'
import { windowManager } from '../../window-manager'
import { checkAndWarnShortcutConflict, formatShortcutLogInfo } from '../shortcut-utils'

/**
 * 已注册的全局快捷键映射表
 * key: 快捷键组合（accelerator）
 * value: 快捷键配置信息
 */
const registeredShortcuts = new Map<string, ShortcutConfig>()

/**
 * 注册全局快捷键
 * @param config 快捷键配置对象
 * @returns 是否注册成功
 */
export function registerGlobalShortcut(config: GlobalShortcutConfig): boolean {
  const { accelerator, windowType, onPress } = config

  /** 如果该快捷键已经注册，先取消注册 */
  if (registeredShortcuts.has(accelerator)) {
    const existingConfig = registeredShortcuts.get(accelerator)
    if (checkAndWarnShortcutConflict(accelerator, existingConfig, '全局快捷键')) {
      globalShortcut.unregister(accelerator)
      registeredShortcuts.delete(accelerator)
    }
  }

  const success = globalShortcut.register(accelerator, () => {
    onPress?.()

    /** 如果配置了窗口类型，则切换窗口显示状态 */
    if (windowType) {
      try {
        windowManager.toggle(windowType)
      }
      catch (error) {
        logError('切换窗口失败', error, {
          module: 'shortcuts',
          operation: 'registerGlobalShortcut',
          context: { accelerator, windowType },
        })
      }
    }
  })

  if (success) {
    registeredShortcuts.set(accelerator, { windowType, onPress })
    const logInfo = formatShortcutLogInfo({
      shortcutType: '全局快捷键',
      accelerator,
      windowType,
      hasCallback: !!onPress,
      callbackLabel: '自定义回调',
    })
    console.log(logInfo)
  }
  else {
    logError(`全局快捷键注册失败: ${accelerator}`, undefined, {
      module: 'shortcuts',
      operation: 'registerGlobalShortcut',
      context: { accelerator },
    })
  }

  return success
}

/**
 * 取消注册指定的全局快捷键
 * @param accelerator 快捷键组合，如果不提供则取消所有快捷键
 */
export function unregisterGlobalShortcut(accelerator?: string): void {
  if (accelerator) {
    /** 取消注册指定的快捷键 */
    if (registeredShortcuts.has(accelerator)) {
      globalShortcut.unregister(accelerator)
      registeredShortcuts.delete(accelerator)
      console.log(`全局快捷键已取消注册: ${accelerator}`)
    }
  }
  else {
    /** 取消注册所有快捷键 */
    unregisterAllGlobalShortcuts()
  }
}

/**
 * 取消注册所有全局快捷键
 */
export function unregisterAllGlobalShortcuts(): void {
  globalShortcut.unregisterAll()
  registeredShortcuts.clear()
  console.log('所有全局快捷键已取消注册')
}

/**
 * 获取已注册的全局快捷键列表
 * @returns 已注册的快捷键数组
 */
export function getRegisteredShortcuts(): string[] {
  return Array.from(registeredShortcuts.keys())
}

/**
 * 检查指定的快捷键是否已注册
 * @param accelerator 快捷键组合
 * @returns 是否已注册
 */
export function isShortcutRegistered(accelerator: string): boolean {
  return registeredShortcuts.has(accelerator)
}

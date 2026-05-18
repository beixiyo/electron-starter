import type { WindowType } from '@shared'

/**
 * 格式化快捷键注册日志信息
 * @param options 日志信息选项
 * @returns 格式化后的日志字符串
 */
export function formatShortcutLogInfo(options: ShortcutLogInfoOptions): string {
  const {
    shortcutType,
    accelerator,
    windowType,
    showWindow,
    hasCallback,
    callbackLabel = '自定义回调',
  } = options

  const logParts: string[] = [
    `${shortcutType}已注册: ${accelerator}`,
  ]

  /** 窗口类型信息 */
  if (windowType) {
    logParts.push(`窗口类型: ${windowType}`)
  }
  else if (showWindow !== undefined) {
    /** 仅当 showWindow 明确设置且 windowType 不存在时，显示 "窗口类型: 无" */
    logParts.push('窗口类型: 无')
  }

  /**
   * 显示窗口信息（仅用于长按快捷键）
   * 原逻辑：showWindow && windowType ? '显示窗口: 是' : '显示窗口: 否'
   */
  if (showWindow !== undefined) {
    const shouldShowWindow = showWindow && windowType
    logParts.push(`显示窗口: ${shouldShowWindow
      ? '是'
      : '否'}`)
  }

  /** 回调函数信息 */
  if (hasCallback) {
    logParts.push(`${callbackLabel}: 已配置`)
  }

  return logParts.filter(Boolean).join(', ')
}

/**
 * 检查并警告快捷键冲突
 * @param accelerator 快捷键组合
 * @param existingConfig 已存在的配置（如果存在）
 * @param shortcutType 快捷键类型名称（用于日志），例如 "全局快捷键" 或 "长按快捷键"
 * @returns 是否存在冲突（true 表示存在冲突，需要清理）
 */
export function checkAndWarnShortcutConflict<T extends ShortcutConfigBase>(
  accelerator: string,
  existingConfig: T | undefined,
  shortcutType: string = '快捷键',
): boolean {
  if (!existingConfig) {
    return false
  }

  const windowTypeInfo = existingConfig.windowType
    ? ` (窗口类型: ${existingConfig.windowType})`
    : ' (无窗口)'

  console.warn(
    `${shortcutType}冲突 ${accelerator}${windowTypeInfo}\n已删除并重新注册中...`,
  )

  return true
}

/**
 * 快捷键配置基础接口（用于冲突检测）
 */
export interface ShortcutConfigBase {
  windowType?: WindowType
}

/**
 * 日志信息构建选项
 */
export interface ShortcutLogInfoOptions {
  /** 快捷键类型名称，例如 "全局快捷键" 或 "长按全局快捷键" */
  shortcutType: string
  /** 快捷键组合 */
  accelerator: string
  /** 窗口类型（可选） */
  windowType?: WindowType
  /** 是否显示窗口（仅用于长按快捷键） */
  showWindow?: boolean
  /** 是否有自定义回调（onPress 或 onRelease） */
  hasCallback?: boolean
  /** 回调类型名称（用于日志），例如 "自定义回调" 或 "回调函数" */
  callbackLabel?: string
}

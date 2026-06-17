import type { WindowType } from '@shared'

/**
 * 全局快捷键配置
 */
export type GlobalShortcutConfig = {
  /** 快捷键组合，例如 'CommandOrControl+Shift+V' */
  accelerator: string
  /** 目标窗口类型，如果配置了则会在按下时切换窗口显示状态 */
  windowType?: WindowType
  /** 按下时的自定义回调函数 */
  onPress?: () => void
}

/**
 * 长按全局快捷键配置
 */
export type HoldGlobalShortcutConfig = {
  /** 快捷键组合，例如 'CommandOrControl+Shift+V' */
  accelerator: string
  /** 目标窗口类型，可选。如果不提供，则不会打开窗口，但仍会管理长按状态 */
  windowType?: WindowType
  /** 是否显示窗口，默认为 true。如果 windowType 未提供，此选项无效 */
  showWindow?: boolean
  /** 长按开始前的门禁，例如权限检查；返回 false 时不进入长按态 */
  canStart?: () => boolean | Promise<boolean>
  /** 松开时的回调函数，接收结果数据 */
  onRelease?: (result: unknown) => void
}

/**
 * 普通快捷键内部配置
 */
export type ShortcutConfig = {
  windowType?: WindowType
  onPress?: () => void
}

/**
 * 长按快捷键内部配置
 */
export type HoldShortcutConfig = {
  windowType?: WindowType
  showWindow?: boolean
  canStart?: () => boolean | Promise<boolean>
  onRelease?: (result: unknown) => void
}

/**
 * 双击全局快捷键配置
 */
export type DoublePressGlobalShortcutConfig = {
  /** 快捷键组合，例如 'CommandOrControl+E' */
  accelerator: string
  /** 目标窗口类型，双击触发时切换窗口 */
  windowType?: WindowType
  /** 第一次按下时的回调（每次首次按下都会触发） */
  onFirstPress?: () => void
  /** 双击触发时的回调 */
  onDoublePress?: () => void
}

/**
 * 双击快捷键内部配置
 */
export type DoublePressShortcutConfig = {
  windowType?: WindowType
  onFirstPress?: () => void
  onDoublePress?: () => void
}

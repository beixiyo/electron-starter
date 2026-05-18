import type { BrowserWindowConstructorOptions } from 'electron'
import type { WindowType } from '../types/window'

/**
 * 内部使用的虚拟 WindowType，用于没有窗口的长按状态
 * 这个值不应该在实际的窗口操作中使用
 */
export const INTERNAL_HOLD_NO_WINDOW = '__INTERNAL_HOLD_NO_WINDOW__' as const

/** 长按开始配置 */
export interface HoldStartConfig {
  /** 窗口类型，可选。如果不提供，则使用内部虚拟类型，不会打开窗口 */
  type?: WindowType
  /** 松开时的回调函数，接收结果数据 */
  onRelease?: (result: unknown) => void
  /** 是否显示窗口，默认为 true。如果 type 未提供，此选项无效 */
  showWindow?: boolean
}

/** 长按结束配置 */
export interface HoldEndConfig {
  /** 窗口类型，可选。如果不提供，则使用内部虚拟类型 */
  type?: WindowType
  /** 结果数据 */
  result?: unknown
  /** 是否隐藏窗口，默认为 true。如果 type 未提供，此选项无效 */
  hideWindow?: boolean
}

/**
 * 窗口位置策略
 */
export type WindowPosition
  = | 'center' // 屏幕居中
    | 'top-center' // 屏幕顶部居中
    | 'bottom-center' // 屏幕底部居中
    | 'top-left' // 屏幕左上角
    | 'top-right' // 屏幕右上角
    | 'bottom-left' // 屏幕左下角
    | 'bottom-right' // 屏幕右下角
    | { x: number, y: number } // 自定义坐标

/**
 * 窗口配置接口
 */
export interface WindowConfig extends BrowserWindowConstructorOptions {
  position?: WindowPosition
  /**
   * 本地 HTML 入口。若提供 initialUrl，则可以省略
   */
  htmlPath?: string
  /**
   * 远程 URL 入口，常用于 OAuth 这类外部站点
   */
  initialUrl?: string
  openDevTools?: boolean | Electron.OpenDevToolsOptions
  /**
   * 显示窗口时是否动态设置为置顶
   * 如果为 true，显示时调用 setAlwaysOnTop(true)，隐藏时调用 setAlwaysOnTop(false)
   * 这样可以覆盖创建时的 alwaysOnTop 配置，实现动态控制
   */
  setAlwaysOnTopOnShow?: boolean
}

/** 长按状态信息 */
export interface HoldState {
  isHolding: boolean
  startTime: number
  windowType: WindowType | typeof INTERNAL_HOLD_NO_WINDOW
  /** 仅在主进程中使用，不通过 IPC 传输 */
  onRelease?: (result: unknown) => void
}

/** 可通过 IPC 传输的长按状态信息（不包含函数） */
export interface SerializableHoldState {
  isHolding: boolean
  startTime: number
  windowType: WindowType | typeof INTERNAL_HOLD_NO_WINDOW
}

/**
 * registerFnShortcuts 的统一配置
 *
 * hold / doublePress / combos 三者互斥，
 * 通过 300ms DECIDING 窗口自动裁决用户意图
 */
export type FnShortcutsConfig = {
  hold?: {
    windowType?: WindowType
    showWindow?: boolean
    onRelease?: (result: any) => void
  }
  doublePress?: {
    windowType?: WindowType
    onTrigger: () => void
  }
  combos?: Array<{
    /** Electron accelerator，如 'Space'、'A' */
    key: string
    onTrigger: () => void
  }>
}

export interface WindowMetadata {
  type: WindowType
  config: WindowConfig
  createdAt: number
}

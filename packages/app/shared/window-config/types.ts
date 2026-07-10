import type { BrowserWindowConstructorOptions } from 'electron'
import type { WindowType } from '../types/window'

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
   * 是否挂载应用预加载脚本
   *
   * @default true
   */
  useAppPreload?: boolean
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
  /**
   * macOS 原生全屏 Space 辅助窗口（type: 'panel' 非激活面板）
   * 用于 Voice IME / 截图蒙层这类需要显示在绿灯全屏窗口上的浮窗
   *
   * panel 带 NSWindowStyleMaskNonactivatingPanel：show/focus/点击都不会激活 App，
   * hide 时也不会触发 AppKit 把 key window 移交给同 App 的其他窗口（如 main）并前置
   *
   * @default false
   */
  macFullscreenAuxiliary?: boolean
  /**
   * 是否持久化窗口尺寸/位置
   * 为 true 时：创建时回填上次保存的 bounds（已做屏幕内裁剪），
   * resize / move 时防抖落盘到 userData
   *
   * @default false
   */
  persistBounds?: boolean
}

/** 窗口矩形边界（屏幕坐标，单位 DIP） */
export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowMetadata {
  type: WindowType
  config: WindowConfig
  createdAt: number
}

import type { BrowserWindowConstructorOptions } from 'electron'
import type { WindowType } from '../types/window'

/**
 * 窗口位置策略
 */
export type WindowPosition =
  | 'center' // 屏幕居中
  | 'top-center' // 屏幕顶部居中
  | 'bottom-center' // 屏幕底部居中
  | 'top-left' // 屏幕左上角
  | 'top-right' // 屏幕右上角
  | 'bottom-left' // 屏幕左下角
  | 'bottom-right' // 屏幕右下角
  | { x: number; y: number } // 自定义坐标

/**
 * 窗口落在哪块屏
 *
 * Electron 没有直接表示当前焦点屏的 API，`cursor` 用光标所在屏作为通用代理。
 * 指定屏已拔掉，或没有可用的聚焦窗口时，解析层会回落到光标所在屏
 */
export type WindowDisplayTarget =
  | 'cursor'
  | 'primary'
  | 'focused-window'
  | { displayId: number }

/**
 * 窗口配置接口
 */
export interface WindowConfig extends BrowserWindowConstructorOptions {
  position?: WindowPosition
  /**
   * 创建窗口以及按配置重新落位时使用的目标屏
   *
   * @default 'cursor'
   */
  targetDisplay?: WindowDisplayTarget
  /**
   * 每次展示时是否按 `targetDisplay` 重新计算预设位置
   *
   * 对不可拖动且位置完全由预设决定的窗口应设为 true；可拖动窗口应保持 false，
   * 避免展示时覆盖用户上次摆放的位置
   *
   * @default false
   */
  repositionOnShow?: boolean
  /**
   * 透明窗口中，可见内容相对 BrowserWindow 四边的留白
   *
   * 位置预设与本仓的边界收敛都按「可见内容」而非窗口边计量：声明之后，
   * 纯透明的阴影留白允许越过工作区边缘，可见内容仍被保证留在工作区内
   *
   * 注意这只是本仓自己的口径。系统那道边界收敛能不能一并解除另有条件
   * （无边框 + 不可拖动），见 `allowsFrameOutsideWorkArea`——不满足时，
   * 窗口仍会在展示那一刻被系统夹回可用区
   *
   * @default 透明无边框且自绘投影（`hasShadow: false`）的窗口按 `SHADOW_WINDOW_INSETS`，其余四边皆 0
   */
  visibleContentInsets?: Partial<WindowInsets>
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
   * alwaysOnTop 使用的 Electron 层级
   *
   * 创建路径与 {@link setAlwaysOnTopOnShow} 的展示路径读同一个值，
   * 避免同一个窗口按不同路径拿到不同层级
   *
   * @default 'floating'
   */
  alwaysOnTopLevel?: AlwaysOnTopLevel
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

/** 窗口四边内距（屏幕坐标，单位 DIP） */
export interface WindowInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface WindowMetadata {
  type: WindowType
  config: WindowConfig
  createdAt: number
}

/** `BrowserWindow.setAlwaysOnTop` 支持的层级，由低到高 */
export type AlwaysOnTopLevel =
  | 'normal'
  | 'floating'
  | 'torn-off-menu'
  | 'modal-panel'
  | 'main-menu'
  | 'status'
  | 'pop-up-menu'
  | 'screen-saver'

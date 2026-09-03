import type { MediaSessionSnapshot } from './media'

export type DesktopSourceOptions = {
  types?: Array<'screen' | 'window'>
  thumbnailSize?: {
    width: number
    height: number
  }
  fetchWindowIcons?: boolean
}

export type DesktopSourceSnapshot = {
  id: string
  name: string
  displayId?: string
  appIcon?: string | null
  thumbnail?: string | null
  /** 是否可以捕获系统音频 */
  canSystemAudio: boolean
}

export type DesktopSourceResponse = {
  sources: DesktopSourceSnapshot[]
  session: MediaSessionSnapshot
}

export type DesktopCapturerBridge = {
  getSources: (options?: DesktopSourceOptions) => Promise<DesktopSourceSnapshot[]>
}

/**
 * 窗口类型枚举
 */
export enum WindowType {
  /** 主窗口 */
  MAIN = 'main',
  /** Voice IME 语音输入悬浮窗 */
  VOICE_IME = 'voice-ime',
  /** OAuth 授权窗口 */
  OAUTH = 'oauth',
  /** 选中文本显示窗口 */
  SELECTION = 'selection',
  /** 快捷键测试窗口 */
  SHORTCUT_TEST = 'shortcut-test',
  /** 单窗口点击穿透焦点检测窗口 */
  FOCUS_NATIVE = 'focus-native',
  /** MenuBar 托盘面板窗口 */
  MENUBAR = 'menubar',
  /** 会议检测提醒浮窗 */
  MEETING_TOAST = 'meeting-toast',
  /** 不抢焦点的全局提示浮窗 */
  GLOBAL_TOAST = 'global-toast',
  /** 状态类浮窗池 */
  FLOATING_STATUS_POOL = 'floating-status-pool',
  /** 工具面板浮窗池 */
  UTILITY_PANEL_POOL = 'utility-panel-pool',
  /** 系统权限拖拽引导卡片：贴在「系统设置」窗口下方，供用户把 App 拖进隐私列表 */
  PERMISSION_DRAG_GUIDE = 'permission-drag-guide',
}

/**
 * 窗口操作响应
 */
export type WindowOperationResult = {
  success: boolean
  error?: string
  windowId?: number
  visible?: boolean
  exists?: boolean
}

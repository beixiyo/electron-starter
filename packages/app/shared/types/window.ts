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

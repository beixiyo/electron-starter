/**
 * macOS 媒体权限类型
 * 对应 Electron systemPreferences.getMediaAccessStatus 的入参
 */
export type MediaType = 'microphone' | 'camera' | 'screen'

/**
 * macOS 媒体权限状态
 * 对应 Electron systemPreferences.getMediaAccessStatus 的返回值
 */
export type MediaAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'

export type DesktopSourcePayload = {
  id: string
  name: string
  displayId?: string
  appIcon?: string | null
  thumbnail?: string | null
  canSystemAudio: boolean
}

export type MediaSessionSnapshot = {
  /** 系统音频是否启用 */
  systemAudio: boolean
  /** 麦克风权限状态 */
  microphoneAccess: MediaAccessStatus
  /** 屏幕录制权限状态 */
  screenAccess: MediaAccessStatus
}

export type SaveBufferPayload = {
  buffer: ArrayBuffer | Buffer
  mimeType?: string
  defaultPath?: string
}

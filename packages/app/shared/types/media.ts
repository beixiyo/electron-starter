import type { systemPreferences } from 'electron'

export type MediaType = Parameters<typeof systemPreferences.getMediaAccessStatus>[0]
export type MediaAccessStatus = ReturnType<typeof systemPreferences.getMediaAccessStatus>

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

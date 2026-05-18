export type DesktopSourceInfo = {
  id: string
  name: string
  displayId?: string
  thumbnail?: string | null
  appIcon?: string | null
  canSystemAudio: boolean
}

export type MediaAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'

export type MediaSessionSnapshot = {
  systemAudio: boolean
  microphoneAccess: MediaAccessStatus
  screenAccess: MediaAccessStatus
}

export type DesktopSourceFetchOptions = {
  types?: Array<'screen' | 'window'>
  thumbnailWidth?: number
  thumbnailHeight?: number
  fetchWindowIcons?: boolean
}

export type DesktopSourceFetchResult = {
  sources: DesktopSourceInfo[]
  session: MediaSessionSnapshot
}

/**
 * 拉取 desktopCapturer 的源列表与当前系统状态
 */
export async function fetchDesktopSources(options?: DesktopSourceFetchOptions) {
  const {
    types = ['screen'],
    thumbnailWidth = 320,
    thumbnailHeight = 180,
    fetchWindowIcons = true,
  } = options || {}

  return $ipc.media.getSources({
    types,
    fetchWindowIcons,
    thumbnailSize: {
      width: thumbnailWidth,
      height: thumbnailHeight,
    },
  })
}

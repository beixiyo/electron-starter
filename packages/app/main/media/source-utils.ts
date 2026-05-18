import type { DesktopSourcePayload } from '@shared'
import type { DesktopCapturerSource, NativeImage } from 'electron'

/**
 * 将图片对象安全转换为 data url
 */
export function toDataUrl(image?: NativeImage | null): string | null {
  if (!image)
    return null
  try {
    return image.toDataURL()
  }
  catch {
    return null
  }
}

/**
 * 将 Electron 源对象映射为渲染层可用的结构
 */
export function buildSourcePayload(sources: DesktopCapturerSource[]): DesktopSourcePayload[] {
  return sources.map(source => ({
    id: source.id,
    name: source.name,
    displayId: source.display_id,
    appIcon: toDataUrl(source.appIcon),
    thumbnail: toDataUrl(source.thumbnail),
    canSystemAudio: source.id.startsWith('screen:'),
  }))
}

/** 更新元数据的安装包识别与 IPC 裁剪。 */
import { basename } from 'node:path'
import type { UpdateInfoLite } from '../contract'
import type { PendingDownloadTarget, UpdateInfoWithFiles } from './types'

export function getPendingDownloadTarget(info: UpdateInfoWithFiles): PendingDownloadTarget | null {
  const files = Array.isArray(info.files)
    ? info.files
    : []
  const updateFile = files.find(file => typeof file.url === 'string' && isSupportedUpdateFile(file.url))

  if (updateFile?.url) {
    return {
      fileName: getFileName(updateFile.url),
      total: typeof updateFile.size === 'number'
        ? updateFile.size
        : 0,
    }
  }

  if (typeof info.path === 'string' && isSupportedUpdateFile(info.path)) {
    return {
      fileName: getFileName(info.path),
      total: typeof info.size === 'number'
        ? info.size
        : 0,
    }
  }

  return null
}

export function isSupportedUpdateFile(urlOrPath: string): boolean {
  const name = getFileName(urlOrPath)
  return getPlatformUpdateExtensions().some(extension => name.endsWith(extension))
}

function getPlatformUpdateExtensions(): string[] {
  if (process.platform === 'darwin')
    return ['.zip']

  if (process.platform === 'win32')
    return ['.exe']

  return ['.AppImage']
}

function getFileName(urlOrPath: string): string {
  try {
    return basename(decodeURIComponent(new URL(urlOrPath).pathname))
  }
  catch {
    return basename(decodeURIComponent(urlOrPath))
  }
}


/** 把 electron-updater 的 UpdateInfo 归一化为可序列化的精简结构 */
export function toLite(info: UpdateInfoWithFiles & { version: string, releaseDate?: string, releaseNotes?: unknown }): UpdateInfoLite {
  const size = getPendingDownloadTarget(info)?.total
  return {
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : undefined,
    size: size && size > 0
      ? size
      : undefined,
  }
}

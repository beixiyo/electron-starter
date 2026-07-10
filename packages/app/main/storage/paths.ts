import { homedir } from 'node:os'
import { join } from 'node:path'
import { APP_STORAGE_DIR_NAME, assertStorageAreaOwner, STORAGE_ROOTS } from '@shared/storage'
import { app } from 'electron'

export const APP_STORAGE_DIR = join(homedir(), APP_STORAGE_DIR_NAME)

/**
 * 获取 `~/.electron-app` 下已登记存储区的绝对路径
 */
export function getAppStorageAreaPath(
  areaId: 'main-json-store' | 'recording-recovery-files' | 'native-diagnostic-log',
  ...segments: string[]
): string {
  const area = assertStorageAreaOwner(areaId, 'main')
  if (area.root !== STORAGE_ROOTS.appHome) {
    throw new Error(`[storage] 存储区「${areaId}」不在 .electron-app 下`)
  }

  return join(APP_STORAGE_DIR, ...splitStorageBasePath(area.basePath), ...segments)
}

/**
 * 获取 Electron userData 下已登记存储区的绝对路径
 */
export function getUserDataStorageAreaPath(
  areaId: 'window-bounds',
  ...segments: string[]
): string {
  const area = assertStorageAreaOwner(areaId, 'main')
  if (area.root !== STORAGE_ROOTS.electronUserData) {
    throw new Error(`[storage] 存储区「${areaId}」不在 Electron userData 下`)
  }

  return join(app.getPath('userData'), ...splitStorageBasePath(area.basePath), ...segments)
}

/**
 * 获取 electron-updater 跨平台缓存目录下已登记存储区的绝对路径
 */
export function getUpdaterCacheStorageAreaPath(
  areaId: 'updater-cache',
  ...segments: string[]
): string {
  const area = assertStorageAreaOwner(areaId, 'main')
  if (area.root !== STORAGE_ROOTS.updaterCache) {
    throw new Error(`[storage] 存储区「${areaId}」不在 updater 缓存目录下`)
  }

  return join(getPlatformUpdaterCacheDir(), ...splitStorageBasePath(area.basePath), ...segments)
}

function getPlatformUpdaterCacheDir(): string {
  if (process.platform === 'win32')
    return process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')

  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Caches')

  return process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
}

function splitStorageBasePath(basePath: string): string[] {
  return basePath
    ? basePath.split('/').filter(Boolean)
    : []
}

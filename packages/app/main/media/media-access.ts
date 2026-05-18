import type { MediaAccessStatus, MediaType } from '@shared'
import { systemPreferences } from 'electron'
import { safeExecute, safeExecuteAsync } from '../utils/error-handler'
import { logWarn } from '../utils/logger'

/**
 * 查询系统级媒体权限状态
 * @param kind 媒体类型（'microphone' | 'camera' | 'screen'）
 * @returns 权限状态
 */
export function getMediaAccessStatus(kind: MediaType): MediaAccessStatus {
  const canQueryStatus = typeof systemPreferences.getMediaAccessStatus === 'function'

  if (!canQueryStatus) {
    logWarn('系统不支持查询媒体权限状态', {
      module: 'media-access',
      operation: 'getMediaAccessStatus',
      context: { kind, platform: process.platform },
    })
    return 'unknown'
  }

  return safeExecute(
    () => {
      const status = systemPreferences.getMediaAccessStatus(kind)
      if (status === undefined || status === null) {
        logWarn('系统返回了无效的权限状态', {
          module: 'media-access',
          operation: 'getMediaAccessStatus',
          context: { kind, returnedStatus: status },
        })
        return 'unknown' as MediaAccessStatus
      }
      return status as MediaAccessStatus
    },
    'unknown' as MediaAccessStatus,
    {
      module: 'media-access',
      operation: 'getMediaAccessStatus',
      context: { kind },
    },
  )
}

/**
 * 主动申请媒体权限
 * @param kind 媒体类型（'microphone' | 'camera' | 'screen'）
 * @returns 权限状态
 */
export async function requestMediaAccess(kind: MediaType): Promise<MediaAccessStatus> {
  /** askForMediaAccess 仅支持 microphone / camera，screen 需要由系统在首次调用 desktopCapturer 时自动弹窗 */
  if (kind === 'screen') {
    return getMediaAccessStatus(kind)
  }

  const canRequestAccess = typeof systemPreferences.askForMediaAccess === 'function'

  if (!canRequestAccess) {
    logWarn('系统不支持主动申请媒体权限', {
      module: 'media-access',
      operation: 'requestMediaAccess',
      context: { kind, platform: process.platform },
    })
    return getMediaAccessStatus(kind)
  }

  return safeExecuteAsync(
    async () => {
      const granted = await systemPreferences.askForMediaAccess(kind)
      return granted
        ? 'granted' as MediaAccessStatus
        : 'denied' as MediaAccessStatus
    },
    'denied' as MediaAccessStatus,
    {
      module: 'media-access',
      operation: 'requestMediaAccess',
      context: { kind },
    },
  )
}

/**
 * 检查并申请媒体权限
 * @param kind 媒体类型（'microphone' | 'camera' | 'screen'）
 * @returns 权限状态
 */
export async function ensureMediaAccess(kind: MediaType): Promise<MediaAccessStatus> {
  const currentStatus = getMediaAccessStatus(kind)

  /** 如果已经授予权限，直接返回 */
  if (currentStatus === 'granted') {
    return currentStatus
  }

  /** 如果需要申请权限，主动申请 */
  if (currentStatus === 'not-determined' || currentStatus === 'restricted') {
    return await requestMediaAccess(kind)
  }

  /** 如果权限被拒绝，返回当前状态 */
  return currentStatus
}

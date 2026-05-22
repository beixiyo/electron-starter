import type { DesktopSourceOptions, SaveBufferPayload } from '@shared'
import type { MediaContract } from './contract'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createIpcService } from '@ipc/core'
import { buildSourcePayload, getMediaAccessStatus, mediaSessionStore, PermissionGuidance, resolveExtension } from '@main/media'
import { logWarn } from '@main/utils/logger'
import { app, desktopCapturer, dialog } from 'electron'

export const mediaService = createIpcService<MediaContract>('media', {
  /**
   * 拉取桌面源及系统权限状态
   */
  async getSources(event: any, options?: DesktopSourceOptions) {
    const {
      types = ['screen', 'window'],
      fetchWindowIcons = true,
      thumbnailSize = { width: 320, height: 180 },
    } = options || {}

    try {
      /** 检查屏幕权限（仅在明确被拒绝时阻止，not-determined 由 desktopCapturer 触发系统弹窗） */
      const screenNeeded = types.includes('screen')
      if (screenNeeded) {
        const screenAccess = getMediaAccessStatus('screen')
        if (screenAccess === 'denied') {
          logWarn('屏幕录制权限被拒绝，无法获取屏幕源', {
            module: 'media-handlers',
            operation: 'getSources',
            context: { types },
          })

          await PermissionGuidance.showPermissionGuidance('screen', screenAccess)

          const snapshot = mediaSessionStore.updateSnapshot(event.sender.id, {
            microphoneAccess: getMediaAccessStatus('microphone'),
            screenAccess,
          })
          return {
            sources: [],
            session: snapshot,
          }
        }
      }

      /** 获取桌面源 */
      const sources = await desktopCapturer.getSources({
        types,
        fetchWindowIcons,
        thumbnailSize,
      })

      const snapshot = mediaSessionStore.updateSnapshot(event.sender.id, {
        microphoneAccess: getMediaAccessStatus('microphone'),
        screenAccess: getMediaAccessStatus('screen'),
      })

      return {
        sources: buildSourcePayload(sources),
        session: snapshot,
      }
    }
    catch (error) {
      logWarn('获取桌面源时发生错误', {
        module: 'media-handlers',
        operation: 'getSources',
        context: { error: String(error), types },
      })

      /** 错误时返回空源列表和当前权限状态 */
      const snapshot = mediaSessionStore.updateSnapshot(event.sender.id, {
        microphoneAccess: getMediaAccessStatus('microphone'),
        screenAccess: getMediaAccessStatus('screen'),
      })

      return {
        sources: [],
        session: snapshot,
      }
    }
  },

  /**
   * 保存通用二进制数据
   */
  async saveBuffer(_event, payload: SaveBufferPayload) {
    if (!payload?.buffer)
      return { canceled: true }

    const extension = resolveExtension(payload.mimeType)
    const defaultName = payload.defaultPath
      ?? `capture-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '保存录制文件',
      defaultPath: join(app.getPath('videos'), defaultName),
      filters: [
        {
          name: extension.toUpperCase(),
          extensions: [extension],
        },
        {
          name: '所有文件',
          extensions: ['*'],
        },
      ],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })

    if (canceled || !filePath)
      return { canceled: true }

    const nodeBuffer = Buffer.isBuffer(payload.buffer)
      ? payload.buffer
      : Buffer.from(payload.buffer)

    await writeFile(filePath, nodeBuffer)
    return { canceled: false, filePath }
  },

  /**
   * 更新系统音频偏好（用于主进程缓存）
   */
  async toggleSystemAudio(event: any, options: { enabled: boolean }) {
    const { enabled } = options
    const snapshot = mediaSessionStore.updateSnapshot(event.sender.id, {
      systemAudio: !!enabled,
    })
    return snapshot
  },
})

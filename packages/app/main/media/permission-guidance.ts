import type { MediaAccessStatus, MediaType } from '@shared'
import { dialog, shell } from 'electron'
import { createMainDiagnosticLogger } from '../logging'
import { windowManager } from '../window-manager/window-manager'

const log = createMainDiagnosticLogger('permission')

/**
 * 权限被拒绝时的处理逻辑
 */
export class PermissionGuidance {
  private static readonly GUIDANCE_MESSAGES = {
    darwin: {
      screen: {
        denied: {
          title: '屏幕录制权限被拒绝',
          message: '为了录制屏幕内容，需要授予屏幕录制权限。请到系统偏好设置 → 安全性与隐私 → 屏幕录制中添加此应用。',
          button: '打开系统偏好设置',
        },
        restricted: {
          title: '屏幕录制权限受限',
          message: '屏幕录制权限受限。请确保应用已添加到屏幕录制的允许列表中。',
          button: '知道了',
        },
      },
      microphone: {
        denied: {
          title: '麦克风权限被拒绝',
          message: '为了录制音频，需要授予麦克风权限。请到系统偏好设置 → 安全性与隐私 → 麦克风中添加此应用。',
          button: '打开系统偏好设置',
        },
        restricted: {
          title: '麦克风权限受限',
          message: '麦克风权限受限。请确保应用已添加到麦克风的允许列表中。',
          button: '知道了',
        },
      },
      camera: {
        denied: {
          title: '摄像头权限被拒绝',
          message: '为了录制视频，需要授予摄像头权限。请到系统偏好设置 → 安全性与隐私 → 摄像头中添加此应用。',
          button: '打开系统偏好设置',
        },
        restricted: {
          title: '摄像头权限受限',
          message: '摄像头权限受限。请确保应用已添加到摄像头的允许列表中。',
          button: '知道了',
        },
      },
    },
    win32: {
      screen: {
        denied: {
          title: '屏幕录制被阻止',
          message: '屏幕录制被阻止。请确保应用有足够的权限来录制屏幕内容。',
          button: '知道了',
        },
        restricted: {
          title: '屏幕录制权限受限',
          message: '屏幕录制权限受限。请检查应用的权限设置。',
          button: '知道了',
        },
      },
      microphone: {
        denied: {
          title: '麦克风权限被拒绝',
          message: '麦克风权限被拒绝。请允许此应用访问麦克风。',
          button: '知道了',
        },
        restricted: {
          title: '麦克风权限受限',
          message: '麦克风权限受限。请检查应用的权限设置。',
          button: '知道了',
        },
      },
      camera: {
        denied: {
          title: '摄像头权限被拒绝',
          message: '摄像头权限被拒绝。请允许此应用访问摄像头。',
          button: '知道了',
        },
        restricted: {
          title: '摄像头权限受限',
          message: '摄像头权限受限。请检查应用的权限设置。',
          button: '知道了',
        },
      },
    },
  }

  /**
   * 显示权限指导对话框
   * @param mediaType 媒体类型
   * @param status 权限状态
   */
  static async showPermissionGuidance(mediaType: MediaType, status: MediaAccessStatus): Promise<void> {
    if (status === 'granted' || status === 'not-determined') {
      return // 不需要显示指导
    }

    const platform = process.platform
    const messages = this.GUIDANCE_MESSAGES[platform as keyof typeof this.GUIDANCE_MESSAGES]

    if (!messages) {
      log.warn('guidance.unsupported-platform', 'showing generic permission guidance', { platform, mediaType, status })
      await dialog.showMessageBox(windowManager.getMainWindow()!, {
        type: 'warning',
        title: '权限问题',
        message: `无法获取 ${mediaType} 权限。请检查应用的权限设置。`,
        buttons: ['确定'],
      })
      return
    }

    const guidance = messages[mediaType]
    if (!guidance) {
      log.warn('guidance.missing-media', 'permission guidance is missing for media type', { mediaType, status, platform })
      return
    }

    const message = guidance[status]
    if (!message) {
      log.warn('guidance.missing-status', 'permission guidance is missing for status', { mediaType, status, platform })
      return
    }

    try {
      const response = await dialog.showMessageBox(windowManager.getMainWindow()!, {
        type: 'warning',
        title: message.title,
        message: message.message,
        buttons: [message.button, '取消'],
        defaultId: 0,
        cancelId: 1,
      })

      /** 如果用户选择打开系统偏好设置（macOS） */
      if (response.response === 0 && platform === 'darwin') {
        this.openSystemPreferences(mediaType)
      }
    }
    catch (error) {
      log.error('guidance.dialog-failed', 'failed to show permission guidance dialog', error, { mediaType, status })
    }
  }

  /**
   * 打开系统偏好设置（仅macOS）
   * @param mediaType 媒体类型
   */
  private static openSystemPreferences(mediaType: MediaType): void {
    const preferenceUrls: Record<MediaType, string> = {
      microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
      screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    }

    const url = preferenceUrls[mediaType]
    if (url) {
      try {
        shell.openExternal(url)
      }
      catch (error) {
        log.error('settings.open-failed', 'failed to open system privacy settings', error, { mediaType })
      }
    }
  }
}

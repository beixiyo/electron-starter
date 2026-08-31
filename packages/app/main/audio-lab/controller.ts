/** 编排音频实验设置的运行时副作用：helper 换代、会议检测启停与最终持久化 */

import type { AudioLabSettings, AudioLabSettingsPatch } from '@shared'
import { forceRestartRecorder } from '@main/audio-recorder'
import { startMeetingDetector, stopMeetingDetector } from '@main/meeting-detection/meeting-detector'
import { recordingState } from '@main/recording-state'
import {
  buildAudioLabSettingsUpdate,
  getAudioLabSettings,
  persistAudioLabSettings,
  setActiveAudioLabSettings,
} from './settings'

/**
 * 更新下一场录音使用的实验设置
 *
 * 输出声道属于 helper 进程级参数，必须在空闲态完成一次有退出确认的换代；其余处理
 * 参数随下一条 start 命令下发。任何一步失败都会恢复进程内设置，不把未生效状态展示给 UI
 */
export async function updateAudioLabSettings(patch: AudioLabSettingsPatch): Promise<AudioLabSettings> {
  if (!recordingState.canStart)
    throw new Error('audio lab settings cannot change while recording is active or finalizing')

  const previous = getAudioLabSettings()
  const next = buildAudioLabSettingsUpdate(patch)
  const outputChannelsChanged = previous.outputChannels !== next.outputChannels
  const meetingDetectionChanged = previous.meetingDetectionEnabled !== next.meetingDetectionEnabled

  setActiveAudioLabSettings(next)
  try {
    if (outputChannelsChanged)
      await forceRestartRecorder()

    if (meetingDetectionChanged) {
      if (next.meetingDetectionEnabled)
        startMeetingDetector()
      else
        stopMeetingDetector()
    }

    persistAudioLabSettings(next)
    return getAudioLabSettings()
  }
  catch (error) {
    setActiveAudioLabSettings(previous)
    throw error
  }
}

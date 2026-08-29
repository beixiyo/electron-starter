import type { MeetingDetectionContract } from './contract'
import { createIpcService } from '@ipc/core'
import { DEFAULT_REALTIME_AUDIO_PROCESSING, startRecording as startNativeRecorder } from '@main/audio-recorder'
import { dismissSession, suppressSession } from '@main/meeting-detection/meeting-detector'
import { failNativeRecordingStart, registerNativeRecordingHandlers } from '@main/native-recording'
import { hasNativeRecordingSession, setNativeRecordingSession } from '@main/native-recording/session'
import { createRecordingRecoverySession } from '@main/recording-recovery'
import { recordingState } from '@main/recording-state'
import { ensureRecordingStorageAvailable, reportRecordingStorageInsufficient } from '@main/recording-storage'
import { isSystemAudioRecordingSupported } from '@main/native-recording/manual'
import { getSelfProcessPids } from '@main/utils/self-pids'

export const meetingDetectionService = createIpcService<MeetingDetectionContract>('meeting-detection', {
  mainHandle: {
    async dismiss(_event, appId: string, pid: number) {
      dismissSession(appId, pid)
    },

    async startRecording(_event, appId: string, pid: number, displayName?: string) {
      if (!recordingState.canStart || hasNativeRecordingSession())
        return

      if (!await ensureRecordingStorageAvailable())
        return

      /** 存储检查期间另一路录音可能已占用共享 helper */
      if (!recordingState.canStart || hasNativeRecordingSession())
        return

      suppressSession(appId, pid)
      const session = createRecordingRecoverySession('meeting', displayName || appId, {
        micAudio: true,
        systemAudio: true,
      })
      setNativeRecordingSession(session)
      recordingState.startMeetingNative()
      let sent = false
      try {
        /** 14.2+ 使用指定会议进程的 tap，旧系统保留 SCK 全系统回退。 */
        sent = startNativeRecorder(session.outputPath, isSystemAudioRecordingSupported()
          ? {
              engine: 'tap',
              tapEnabled: true,
              pids: [pid],
              excludePids: getSelfProcessPids(),
              mic: true,
              audioProcessing: DEFAULT_REALTIME_AUDIO_PROCESSING,
            }
          : undefined)
      }
      catch (error) {
        failNativeRecordingStart(session, 'helper_unavailable', error instanceof Error
          ? error.message
          : String(error))
        return
      }
      if (!sent) {
        failNativeRecordingStart(session, 'helper_unavailable')
        return
      }
    },

    async pauseRecording() {
      recordingState.pause()
    },

    async resumeRecording() {
      if (await ensureRecordingStorageAvailable('resume'))
        recordingState.resume()
    },

    async stopRecording() {
      recordingState.stop()
    },
  },
})

registerNativeRecordingHandlers('meeting', {
  onComplete(session, _filePath, duration) {
    meetingDetectionService.emit('recording-complete', {
      taskId: session.taskId,
      name: session.name || 'meeting-recording',
      duration,
      mimeType: session.mimeType,
    })
  },
  onError(code, detail) {
    if (code === 'storage_insufficient') {
      reportRecordingStorageInsufficient()
      meetingDetectionService.emit('recording-state', { status: 'stopped' })
      return
    }

    meetingDetectionService.emit('recording-error', { code, detail })
    meetingDetectionService.emit('recording-state', { status: 'stopped' })
  },
  onMicDegraded(detail) {
    meetingDetectionService.emit('mic-degraded', { detail })
  },
})

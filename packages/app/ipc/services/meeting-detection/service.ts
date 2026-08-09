import type { MeetingDetectionContract } from './contract'
import { createIpcService } from '@ipc/core'
import { startRecording as startNativeRecorder } from '@main/audio-recorder'
import { dismissSession, suppressSession } from '@main/meeting-detection/meeting-detector'
import { registerNativeRecordingHandlers } from '@main/native-recording'
import { setNativeRecordingSession } from '@main/native-recording/session'
import { createRecordingRecoverySession } from '@main/recording-recovery'
import { recordingState } from '@main/recording-state'
import { ensureRecordingStorageAvailable, reportRecordingStorageInsufficient } from '@main/recording-storage'

export const meetingDetectionService = createIpcService<MeetingDetectionContract>('meeting-detection', {
  mainHandle: {
    async dismiss(_event, appId: string, pid: number) {
      dismissSession(appId, pid)
    },

    async startRecording(_event, appId: string, pid: number, displayName?: string) {
      if (!recordingState.canStart)
        return

      if (!await ensureRecordingStorageAvailable())
        return

      suppressSession(appId, pid)
      const session = createRecordingRecoverySession('meeting', displayName || appId, {
        micAudio: true,
        systemAudio: true,
      })
      setNativeRecordingSession(session)
      recordingState.startMeetingNative()
      startNativeRecorder(session.outputPath)
      console.log(`[meeting-detection] recording started for: ${appId} pid=${pid}`)
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

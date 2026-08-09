import type { IpcContract } from '@ipc/core'

export type MeetingDetectedPayload = {
  appId: string
  displayName: string
  pid: number
}

export type RecordingStatePayload = {
  status: 'recording' | 'paused' | 'mixing' | 'stopped'
  path?: string
  duration?: number
}

export type RecordingCompletePayload = {
  taskId: string
  name: string
  duration: number
  mimeType: string
}

export type MeetingDetectionContract = IpcContract<
  {
    mainHandle: {
      dismiss: (appId: string, pid: number) => void
      startRecording: (appId: string, pid: number, displayName?: string) => void
      pauseRecording: () => void
      resumeRecording: () => void
      stopRecording: () => void
    }
    rendererOn: {
      'detected': MeetingDetectedPayload
      'ended': MeetingDetectedPayload
      'recording-state': RecordingStatePayload
      'recording-complete': RecordingCompletePayload
      'recording-error': RecordingErrorPayload
      'mic-degraded': { detail?: string }
    }
  }
>

export type RecordingErrorPayload = {
  code: string
  detail?: string
}

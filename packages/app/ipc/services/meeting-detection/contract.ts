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
  name: string
  path: string
  duration: number
  mimeType: string
}

export type MeetingDetectionContract = IpcContract<
  {
    dismiss: (appId: string, pid: number) => void
    startRecording: (appId: string, pid: number) => void
    pauseRecording: () => void
    resumeRecording: () => void
    stopRecording: () => void
    readRecordingFile: (filePath: string) => ArrayBuffer
    deleteRecordingFile: (filePath: string) => void
  },
  {
    'detected': MeetingDetectedPayload
    'ended': MeetingDetectedPayload
    'recording-state': RecordingStatePayload
    'recording-complete': RecordingCompletePayload
  }
>

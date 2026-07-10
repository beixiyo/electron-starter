import type { MeetingDetectionContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const meetingDetectionClient = createServiceClient<MeetingDetectionContract>('meeting-detection', [
  'dismiss',
  'startRecording',
  'pauseRecording',
  'resumeRecording',
  'stopRecording',
])

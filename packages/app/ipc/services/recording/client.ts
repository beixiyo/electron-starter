import type { RecordingContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const recordingClient = createServiceClient<RecordingContract>('recording', [
  'getState',
  'start',
  'setManualRecordingPrefs',
  'setAudioSourceCapture',
  'getSystemAudioSupport',
  'pause',
  'resume',
  'stop',
  'reset',
  'readRecordingFile',
  'deleteRecordingFile',
])

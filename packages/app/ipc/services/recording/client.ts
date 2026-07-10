import type { RecordingContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const recordingClient = createServiceClient<RecordingContract>('recording', [
  'getState',
  'start',
  'setManualRecordingPrefs',
  'setAudioSourceCapture',
  'getAudioApps',
  'getSystemAudioSupport',
  'pause',
  'resume',
  'stop',
  'reset',
  'listRecoverableRecordings',
  'readRecordingFile',
  'deleteRecordingFile',
])

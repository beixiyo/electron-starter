import { createServiceClient } from '@ipc/core'
import { VOICE_IME_NAMESPACE, type VoiceImeContract } from './contract'

export const voiceImeClient = createServiceClient<VoiceImeContract>(VOICE_IME_NAMESPACE, [
  'setFocusContext',
  'setShellMetrics',
  'setEmbeddedHost',
  'startClickMode',
  'stopSession',
  'cancelSession',
  'beginTranscribing',
  'endSession',
  'releaseSession',
  'deliverTranscription',
  'markRecordingStarted',
  'getActiveState',
])

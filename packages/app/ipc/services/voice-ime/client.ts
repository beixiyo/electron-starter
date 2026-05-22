import type { VoiceImeContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const voiceImeClient = createServiceClient<VoiceImeContract>('voice-ime', [])

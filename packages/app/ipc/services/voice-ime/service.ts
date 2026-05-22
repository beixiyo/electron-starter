import type { VoiceImeContract } from './contract'
import { createIpcService } from '@ipc/core'

export const voiceImeService = createIpcService<VoiceImeContract>('voice-ime', {})

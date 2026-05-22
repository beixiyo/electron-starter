import type { IpcContract } from '@ipc/core'
import type { VoiceImeRendererStatusPayload } from '@shared'

export type VoiceImeContract = IpcContract<{}, {
  status: VoiceImeRendererStatusPayload
}>

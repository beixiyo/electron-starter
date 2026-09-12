/** Voice IME 状态与会话事件的 main → renderer 推送面。 */

import { createMainToRendererEmitter } from '@ipc/core'
import { VOICE_IME_NAMESPACE, type VoiceImeToRendererContract } from './contract'

export const voiceImeToRenderer = createMainToRendererEmitter<VoiceImeToRendererContract>(VOICE_IME_NAMESPACE)

/** Voice IME 状态与取消事件的 main → renderer 推送面 */

import { createMainToRendererEmitter } from '@ipc/core'
import type { VoiceImeContract } from './contract'

export const voiceImeToRenderer = createMainToRendererEmitter<VoiceImeContract>('voice-ime')

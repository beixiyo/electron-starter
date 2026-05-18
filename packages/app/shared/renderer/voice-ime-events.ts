import type { VoiceRecorderStatus } from 'comps'

export type VoiceImeRendererStatusPayload = {
  /** 语音录制面板的状态 */
  status?: VoiceRecorderStatus
  /** 可选的错误信息 */
  error?: string | null
}

export const VOICE_IME_RENDERER_CHANNEL = {
  STATUS: 'voice-ime:status',
} as const

export type VoiceImeRendererChannel = typeof VOICE_IME_RENDERER_CHANNEL[keyof typeof VOICE_IME_RENDERER_CHANNEL]

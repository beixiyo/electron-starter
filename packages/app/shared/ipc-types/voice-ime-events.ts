import type { VoiceRecorderStatus } from 'comps'

export type VoiceImeRendererStatusPayload = {
  /** 语音录制面板的状态 */
  status?: VoiceRecorderStatus
  /** 可选的错误信息 */
  error?: string | null
}

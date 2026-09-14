import type { IpcContract } from '@ipc/core'
import type {
  VoiceImeActiveState,
  VoiceImeCancelPayload,
  VoiceImeDeliverPayload,
  VoiceImeEmbeddedCommandPayload,
  VoiceImeEmbeddedPromptPayload,
  VoiceImeEmbeddedTranscriptionPayload,
  VoiceImeFloatingCommandPayload,
  VoiceImeFloatingTranscriptionPayload,
  VoiceImeFocusContext,
  VoiceImeHostRegistrationOptions,
  VoiceImeRendererStatusPayload,
  VoiceImeSessionHost,
  VoiceImeShellMetricsPatch,
} from '@shared'
import type { VoiceImeCompletionPayload, VoiceImeStartResponse } from '@shared'

/** voice-ime IPC 使用的固定命名空间。 */
export const VOICE_IME_NAMESPACE = 'voice-ime'

/** 主进程接受的调用面。 */
export type VoiceImeContract = IpcContract<{
  mainHandle: VoiceImeMainHandle
  rendererOn: VoiceImeRendererEvents
}>

/** 只声明 main → renderer 推送面，供无 handler 的 emitter 使用。 */
export type VoiceImeToRendererContract = IpcContract<{
  rendererOn: VoiceImeRendererEvents
}>

/** renderer → main 的会话控制方法。 */
type VoiceImeMainHandle = {
  setFocusContext: (context: VoiceImeFocusContext) => void
  /**
   * 浮层上报壳（可见部分）的度量，缺省字段保持上一次的值
   *
   * 浮层窗口尺寸固定、可见期间不 resize（见 shared 的 `VOICE_IME_SIZE`），主进程摆全局
   * 提示条时靠 `height` 从窗口底边往上算胶囊顶边。只认来自 Voice IME 浮层的上报
   */
  setShellMetrics: (patch: VoiceImeShellMetricsPatch) => void
  setEmbeddedHost: (host: VoiceImeSessionHost, active: boolean, options?: VoiceImeHostRegistrationOptions) => void
  startClickMode: () => VoiceImeStartResponse
  stopSession: (sessionId: string) => boolean
  cancelSession: (sessionId: string) => boolean
  beginTranscribing: (sessionId: string) => boolean
  endSession: (sessionId: string) => boolean
  releaseSession: (payload: VoiceImeCompletionPayload) => void
  deliverTranscription: (payload: VoiceImeDeliverPayload) => void
  markRecordingStarted: (sessionId: string, startedAt: number) => void
  getActiveState: () => VoiceImeActiveState
}

/** main → renderer 的状态和会话事件。 */
type VoiceImeRendererEvents = {
  modeChanged: VoiceImeFloatingCommandPayload
  floatingStart: VoiceImeFloatingCommandPayload
  floatingStop: VoiceImeFloatingCommandPayload
  status: VoiceImeRendererStatusPayload
  transcription: VoiceImeFloatingTranscriptionPayload
  embeddedTranscription: VoiceImeEmbeddedTranscriptionPayload
  activeChanged: VoiceImeActiveState
  cancel: VoiceImeCancelPayload
  dismiss: { reason: 'escape'; sessionId?: string | null }
  embeddedStart: VoiceImeEmbeddedCommandPayload
  embeddedStop: VoiceImeEmbeddedCommandPayload
  blockedPrompt: VoiceImeEmbeddedPromptPayload
}

export type {
  VoiceImeActiveState,
  VoiceImeCancelPayload,
  VoiceImeDeliverPayload,
  VoiceImeFloatingCommandPayload,
  VoiceImeFocusContext,
  VoiceImeHostRegistrationOptions,
  VoiceImeMode,
  VoiceImeSessionHost,
  VoiceImeShellMetrics,
  VoiceImeShellMetricsPatch,
  VoiceImeStartBlocker,
  VoiceImeStartResponse,
  VoiceImeStartResult,
} from '@shared'

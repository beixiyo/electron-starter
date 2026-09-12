/** renderer 完成一轮转写后交给主进程的结果。 */
export type VoiceImeCompletionResult = {
  text: string
  duration: number
} | {
  error: string
  duration: number
}

/** 带会话身份的文本完成载荷。 */
export type VoiceImeCompletionPayload = {
  sessionId: string
  result: VoiceImeCompletionResult
}

/** 主进程启动门禁的返回值。 */
export type VoiceImeStartResult =
  | { started: true; sessionId: string }
  | { started: false; blockedBy: import('./voice-ime-events').VoiceImeStartBlocker }

/** renderer 点击入口可见的启动结果，保留成功 sessionId 供后续回调校验。 */
export type VoiceImeStartResponse =
  | { success: true; sessionId: string }
  | { success: false; blockedBy: import('./voice-ime-events').VoiceImeStartBlocker }

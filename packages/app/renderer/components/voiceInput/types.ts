/** 语音输入 UI 与宿主之间共享的中性类型，不依赖 Electron IPC。 */

export type VoiceInputPhase = 'idle' | 'recording' | 'processing' | 'canceled' | 'failure' | 'result'

export type VoiceInputSurface = 'window' | 'embedded' | 'floating'

export type VoiceInputHostInfo = {
  id: string
  surface: VoiceInputSurface
}

/** 宿主注入的转写适配器；音频只在渲染层内存中流转。 */
export type VoiceTranscribeAdapter = (
  audio: Blob,
  context: VoiceTranscribeContext,
) => Promise<string | VoiceTranscription>

export type VoiceTranscribeContext = {
  sessionId: string
  signal: AbortSignal
}

export type VoiceTranscription = {
  text: string
}

/** 不依赖 ChatInput 的采集驱动，适合窗口级宿主或测试适配器。 */
export type VoiceCaptureAdapter = {
  start: (context: VoiceCaptureContext) => void | Promise<void>
  stop: (context: VoiceCaptureContext) => Blob | Promise<Blob>
  cancel?: (context: VoiceCaptureCancelContext) => void | Promise<void>
  destroy?: () => void | Promise<void>
  getAudioLevel?: () => number
}

export type VoiceCaptureContext = {
  sessionId: string
  signal: AbortSignal
}

export type VoiceCaptureCancelContext = {
  sessionId: string
}

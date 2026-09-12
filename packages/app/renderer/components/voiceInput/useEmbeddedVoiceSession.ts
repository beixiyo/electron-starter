/** 输入宿主通过统一会话管线接收指定宿主的文本。 */
import { useVoiceSession } from './useVoiceSession'
import type { VoiceSessionOptions } from './useVoiceSession'

export function useEmbeddedVoiceSession(options: UseEmbeddedVoiceSessionOptions) {
  return useVoiceSession({
    ...options,
    onTranscription: text => options.onTranscription?.(text, options.host),
  })
}

export type UseEmbeddedVoiceSessionOptions = Omit<VoiceSessionOptions, 'host' | 'onTranscription'> & {
  host: string
  onTranscription?: (text: string, host: string) => void
}

export type EmbeddedVoiceSession = ReturnType<typeof useEmbeddedVoiceSession>

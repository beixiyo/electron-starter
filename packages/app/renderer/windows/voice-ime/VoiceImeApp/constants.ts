/** 语音浮层各状态的尺寸与窗口命中区常量。 */
import { VOICE_IME_SHADOW_INSET } from '@shared'

export { VOICE_IME_SHADOW_INSET }
export const VOICE_UNDO_WINDOW_MS = 5000

export const VOICE_IME_CONTENT_SIZE = {
  /** 提示是固定宽度，其余胶囊形态会在挂载后按内容测宽。 */
  prompt: { width: 320, height: 52 },
  recording: { width: 200, height: 40 },
  canceled: { width: 200, height: 40 },
  failure: { width: 200, height: 40 },
  result: { width: 344, height: 194 },
} as const

export type VoiceImeViewMode = keyof typeof VOICE_IME_CONTENT_SIZE

export const VOICE_IME_WINDOW_SIZE = Object.fromEntries(
  Object.entries(VOICE_IME_CONTENT_SIZE).map(([mode, size]) => [mode, {
    width: size.width + VOICE_IME_SHADOW_INSET * 2,
    height: size.height + VOICE_IME_SHADOW_INSET * 2,
  }]),
) as { [K in VoiceImeViewMode]: { width: number; height: number } }

/** 形态对应的可见圆角；命中区和视觉外壳共用这组值。 */
export const VOICE_IME_RADIUS: Record<VoiceImeViewMode, number> = {
  prompt: 16,
  recording: 999,
  canceled: 999,
  failure: 12,
  result: 24,
}

export const VOICE_IME_HUGGING_VIEWS: readonly VoiceImeViewMode[] = [
  'recording',
  'canceled',
  'failure',
]

/** Voice IME 快捷键策略共享契约 */
import type { ShortcutRuntimeEvent } from '@shared/shortcuts'

export type VoiceImeShortcutActivation = 'hold' | 'toggle'

export type VoiceImeShortcutStrategy = {
  handle: (event: ShortcutRuntimeEvent) => void
  cancelPendingStart: () => void
}

export type VoiceImeShortcutStrategyOptions = {
  start: (shouldContinue: () => boolean) => Promise<void>
  stop: (activation: VoiceImeShortcutActivation) => void
  isRecording: () => boolean
}

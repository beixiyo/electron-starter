/** Voice IME 快捷键策略共享契约 */
import type { VoiceImeMode } from '@shared'
import type { ShortcutRuntimeEvent } from '@shared/shortcuts'

export type VoiceImeShortcutActivation = 'hold' | 'toggle'

export type VoiceImeShortcutStrategy = {
  handle: (event: ShortcutRuntimeEvent) => void
  cancelPendingStart: () => void
}

export type VoiceImeShortcutStrategyOptions = {
  /** 返回本次成功认领的会话；门禁阻断时为 null。 */
  start: (options: VoiceImeShortcutStartOptions) => Promise<string | null>
  /** hold 必须指定自己认领的会话；toggle 的明确停止操作可省略。 */
  stop: (sessionId?: string) => void
  isRecording: () => boolean
}

/** 快捷键启动携带交互模式与本次物理按压是否仍有效的判据。 */
export type VoiceImeShortcutStartOptions = {
  mode: VoiceImeMode
  shouldContinue: () => boolean
}

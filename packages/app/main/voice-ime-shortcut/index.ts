/** 根据 action 声明选择 Voice IME 快捷键策略，统一管理策略生命周期 */
import type { ShortcutRuntimeEvent } from '@shared/shortcuts'
import { createVoiceImeHoldStrategy } from './hold'
import { createVoiceImeToggleStrategy } from './toggle'
import type { VoiceImeShortcutActivation, VoiceImeShortcutStrategy, VoiceImeShortcutStrategyOptions } from './types'

export function createVoiceImeShortcutController(options: VoiceImeShortcutStrategyOptions) {
  const strategies = {
    hold: createVoiceImeHoldStrategy(options),
    toggle: createVoiceImeToggleStrategy(options),
  } satisfies Record<VoiceImeShortcutActivation, VoiceImeShortcutStrategy>

  return {
    handle(event: ShortcutRuntimeEvent, activation: VoiceImeShortcutActivation): void {
      strategies[activation].handle(event)
    },
    cancelPendingStart(): void {
      strategies.hold.cancelPendingStart()
      strategies.toggle.cancelPendingStart()
    },
  }
}

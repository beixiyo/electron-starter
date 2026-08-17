/** 长按策略：达到 hold 阈值后开始，物理按键释放时结束 */
import type { VoiceImeShortcutStrategy, VoiceImeShortcutStrategyOptions } from './types'

export function createVoiceImeHoldStrategy(
  options: VoiceImeShortcutStrategyOptions,
): VoiceImeShortcutStrategy {
  let activeGeneration = 0
  let nextGeneration = 0

  return {
    handle(event) {
      if (event.phase === 'trigger') {
        const generation = ++nextGeneration
        activeGeneration = generation
        void options.start(() => activeGeneration === generation)
        return
      }

      activeGeneration = 0
      options.stop('hold')
    },
    cancelPendingStart() {
      activeGeneration = 0
    },
  }
}

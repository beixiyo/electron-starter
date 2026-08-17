/** 单击切换策略：第一次完整按压开始，录制中再次按压结束 */
import type { VoiceImeShortcutStrategy, VoiceImeShortcutStrategyOptions } from './types'

export function createVoiceImeToggleStrategy(
  options: VoiceImeShortcutStrategyOptions,
): VoiceImeShortcutStrategy {
  let pendingGeneration = 0
  let nextGeneration = 0

  return {
    handle(event) {
      if (event.phase !== 'trigger')
        return

      if (options.isRecording()) {
        options.stop('toggle')
        return
      }

      if (pendingGeneration !== 0) {
        pendingGeneration = 0
        return
      }

      const generation = ++nextGeneration
      pendingGeneration = generation
      void options.start(() => pendingGeneration === generation)
        .finally(() => {
          if (pendingGeneration === generation)
            pendingGeneration = 0
        })
    },
    cancelPendingStart() {
      pendingGeneration = 0
    },
  }
}

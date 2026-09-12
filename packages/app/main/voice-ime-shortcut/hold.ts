/** 长按策略：达到 hold 阈值后开始，物理按键释放时结束 */
import type { VoiceImeShortcutStrategy, VoiceImeShortcutStrategyOptions } from './types'

export function createVoiceImeHoldStrategy(
  options: VoiceImeShortcutStrategyOptions,
): VoiceImeShortcutStrategy {
  let activeGeneration = 0
  let nextGeneration = 0
  let activeSessionId: string | null = null

  return {
    handle(event) {
      if (event.phase === 'trigger') {
        const generation = ++nextGeneration
        activeGeneration = generation
        activeSessionId = null
        void options.start({ mode: 'hold', shouldContinue: () => activeGeneration === generation }).then((sessionId) => {
          if (activeGeneration !== generation) {
            /** 松手可能发生在主进程认领之后、Promise 回来之前，只结束那一轮。 */
            if (sessionId) options.stop(sessionId)
            return
          }
          activeSessionId = sessionId
        })
        return
      }

      activeGeneration = 0
      const sessionId = activeSessionId
      activeSessionId = null
      if (sessionId) options.stop(sessionId)
    },
    cancelPendingStart() {
      activeGeneration = 0
      activeSessionId = null
    },
  }
}

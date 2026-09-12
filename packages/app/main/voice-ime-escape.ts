/** 会话期间的全局 Escape：把取消请求交给当前会话 owner */

import { GLOBAL_ESCAPE_PRIORITY, registerGlobalEscapeConsumer } from './global-escape'
import { createMainDiagnosticLogger } from './logging'
import { voiceImeState } from './voice-ime-state'

const log = createMainDiagnosticLogger('voice-ime')

let activeSessionId: string | null = null
let unregister: (() => void) | null = null

/**
 * 为一轮会话登记全局 Escape
 *
 * 新会话到来时会先替换旧登记；消费者自身还会复核 sessionId，避免旧回调在新会话上生效
 */
export function startVoiceImeEscapeWatcher(
  sessionId: string,
  onEscape: (sessionId: string) => void,
): void {
  if (!sessionId) return
  if (activeSessionId === sessionId && unregister) return

  stopVoiceImeEscapeWatcher()
  activeSessionId = sessionId

  unregister = registerGlobalEscapeConsumer({
    id: 'voice-ime-session',
    priority: GLOBAL_ESCAPE_PRIORITY.session,
    isActive: () => voiceImeState.currentSessionId === sessionId && voiceImeState.isActive,
    onEscape: () => {
      if (voiceImeState.currentSessionId !== sessionId || !voiceImeState.isActive) return

      log.info('escape.pressed', 'global escape requested session cancellation', {
        sessionId,
      })
      onEscape(sessionId)
    },
  })
}

/** 会话结束后注销全局 Escape；重复调用安全 */
export function stopVoiceImeEscapeWatcher(): void {
  unregister?.()
  unregister = null
  activeSessionId = null
}

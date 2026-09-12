/** 窗口和输入宿主共用的撤销、失败通知，生命周期随会话变化清理。 */
import { TaskBanner } from 'comps'
import { memo, useEffect } from 'react'
import type { useVoiceSession } from './useVoiceSession'

export const VoiceSessionNotice = memo<{ session: ReturnType<typeof useVoiceSession> }>(({ session }) => {
  const { phase, error, promptMessage, canRetry, retry, undo, undoExpiresAt } = session
  useEffect(() => {
    if (phase === 'canceled' && undoExpiresAt !== null) {
      const notice = TaskBanner.notify({ content: 'Voice input canceled', action: { text: 'Undo', onClick: () => void undo() }, duration: 0, placement: 'top' })
      return () => notice.close()
    }
    if (promptMessage) {
      const notice = TaskBanner.notify({ content: promptMessage, duration: 5000, placement: 'top' })
      return () => notice.close()
    }
    if (error) {
      const notice = TaskBanner.notify({
        content: error,
        action: canRetry
          ? { text: 'Retry', onClick: () => void retry() }
          : undefined,
        duration: 0,
        placement: 'top',
        showClose: true,
      })
      return () => notice.close()
    }
  }, [phase, error, promptMessage, canRetry, retry, undo, undoExpiresAt])
  return null
})
VoiceSessionNotice.displayName = 'VoiceSessionNotice'

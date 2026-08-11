/** Native 录音启动失败的 watchdog、helper 回收与未成立资产清理 */

import type { NativeRecordingSource } from '@shared'
import type { NativeRecordingSession } from './session'
import { forceRestartRecorder } from '@main/audio-recorder'
import { deleteRecoveryRecording } from '@main/recording-recovery'
import { recordingState } from '@main/recording-state'
import { clearNativeRecordingSession, peekNativeRecordingSession } from './session'

const NATIVE_START_TIMEOUT_MS = 20_000

export function createNativeStartRecovery(
  getErrorHandler: (source: NativeRecordingSource) => NativeStartErrorHandler | undefined,
): NativeStartRecovery {
  let startTimer: ReturnType<typeof setTimeout> | null = null

  function clearTimeout(): void {
    if (!startTimer)
      return
    globalThis.clearTimeout(startTimer)
    startTimer = null
  }

  function settleFailure(
    session: NativeRecordingSession,
    code: string,
    detail: string | undefined,
    context: 'unavailable' | 'timed-out',
  ): void {
    clearTimeout()
    clearNativeRecordingSession()
    recordingState.finishNative()
    getErrorHandler(session.source)?.(code, detail)

    /** helper 可能停在半初始化的 Core Audio 状态，先回收再删除未成立会话的恢复资产 */
    void forceRestartRecorder()
      .catch(error => console.warn(`[native-recording] failed to restart ${context} recorder`, error))
      .finally(() => {
        void deleteRecoveryRecording(session.taskId).catch((error) => {
          console.warn(`[native-recording] failed to delete ${context} recording session`, error)
        })
      })
  }

  function fail(session: NativeRecordingSession, code: string, detail?: string): void {
    const activeSession = peekNativeRecordingSession()
    if (!activeSession || activeSession.taskId !== session.taskId)
      return

    settleFailure(activeSession, code, detail, 'unavailable')
  }

  function arm(): void {
    clearTimeout()
    const session = peekNativeRecordingSession()
    if (!session)
      return

    const { outputPath, taskId } = session
    startTimer = setTimeout(() => {
      startTimer = null
      const activeSession = peekNativeRecordingSession()
      if (
        recordingState.snapshot.phase !== 'starting'
        || activeSession?.taskId !== taskId
        || activeSession.outputPath !== outputPath
      ) {
        return
      }

      settleFailure(
        activeSession,
        'start_timeout',
        `native recorder did not become ready within ${NATIVE_START_TIMEOUT_MS}ms`,
        'timed-out',
      )
    }, NATIVE_START_TIMEOUT_MS)
    startTimer.unref?.()
  }

  return {
    arm,
    clear: clearTimeout,
    fail,
  }
}

type NativeStartErrorHandler = (code: string, detail?: string) => void

type NativeStartRecovery = {
  arm: () => void
  clear: () => void
  fail: (session: NativeRecordingSession, code: string, detail?: string) => void
}

import { app, powerSaveBlocker } from 'electron'
import { createMainDiagnosticLogger } from './logging'

const diag = createMainDiagnosticLogger('app.power')

let recordingBlockerId: number | null = null
let initialized = false

/** 注册退出清理，避免录音结束前退出时残留 blocker */
export function initPowerSaveBlockers(): void {
  if (initialized)
    return

  initialized = true
  app.once('will-quit', stopRecordingPowerSaveBlocker)
}

/** 录音会话存续时保持系统活跃，同时允许显示器自动熄灭 */
export function setRecordingPowerSaveBlocker(active: boolean): void {
  if (active) {
    if (recordingBlockerId != null && powerSaveBlocker.isStarted(recordingBlockerId))
      return

    recordingBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    diag.debug('recording-blocker.started', 'recording power save blocker started', {
      blockerId: recordingBlockerId,
      type: 'prevent-app-suspension',
    })
    return
  }

  stopRecordingPowerSaveBlocker()
}

function stopRecordingPowerSaveBlocker(): void {
  if (recordingBlockerId == null)
    return

  const blockerId = recordingBlockerId
  recordingBlockerId = null
  const stopped = powerSaveBlocker.stop(blockerId)
  diag.debug('recording-blocker.stopped', 'recording power save blocker stopped', {
    blockerId,
    stopped,
  })
}

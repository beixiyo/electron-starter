import type { AudioAppItem, ManualRecordingErrorPayload, RecordingContract } from './contract'
import { createIpcService } from '@ipc/core'
import { getAudioProcessSnapshot, onAudioProcessChange, startAudioMonitor } from '@main/meeting-detection/audio-monitor-bridge'
import { registerNativeRecordingHandlers } from '@main/native-recording'
import {
  isSystemAudioRecordingSupported,
  setAudioSourceCapture,
  setManualRecordingPrefs,
  startManualRecording,
} from '@main/native-recording/manual'
import { peekNativeRecordingSession } from '@main/native-recording/session'
import { deleteRecoveryRecording, listRecoverableRecordings, readRecoveryRecording } from '@main/recording-recovery'
import { recordingState } from '@main/recording-state'
import { getSelfProcessPids } from '@main/utils/self-pids'
import { windowManager } from '@main/window-manager'
import { WindowType } from '@shared'
import { Notification } from 'electron'

function listAudioApps(): AudioAppItem[] {
  const selfPids = new Set(getSelfProcessPids())
  return getAudioProcessSnapshot()
    .filter(process => process.isRunningOutput && !selfPids.has(process.pid))
    .map(process => ({
      pid: process.pid,
      name: process.name,
    }))
}

/**
 * 手动 native tap 录音 IPC 服务（主进程实现）
 *
 * 开录 / 停录 / 音源热切收口在 native-recording 模块，本服务只做 IPC 转发 + 状态广播；
 * 完成 / 错误经 registerNativeRecordingHandlers('manual') 定向主窗，由录音页存 IndexedDB / 弹提示
 */
export const recordingService = createIpcService<RecordingContract>('recording', {
  async getState() {
    return recordingState.snapshot
  },

  async start() {
    return startManualRecording()
  },

  async setManualRecordingPrefs(_event, prefs) {
    setManualRecordingPrefs(prefs)
  },

  async setAudioSourceCapture(_event, options) {
    return setAudioSourceCapture(options)
  },

  async getAudioApps() {
    startAudioMonitor()
    return listAudioApps()
  },

  async getSystemAudioSupport() {
    return isSystemAudioRecordingSupported()
  },

  async pause() {
    return recordingState.pause()
  },

  async resume() {
    return recordingState.resume()
  },

  async stop() {
    return recordingState.stop()
  },

  async reset() {
    return recordingState.reset()
  },

  async listRecoverableRecordings() {
    return listRecoverableRecordings(peekNativeRecordingSession()?.outputPath)
  },

  async readRecordingFile(_event, taskId: string) {
    return readRecoveryRecording(taskId)
  },

  async deleteRecordingFile(_event, taskId: string) {
    await deleteRecoveryRecording(taskId)
  },
})

onAudioProcessChange(() => {
  const mainWin = windowManager.get(WindowType.MAIN)
  if (mainWin && !mainWin.isDestroyed())
    recordingService.emit('audioAppsChanged', listAudioApps(), mainWin)
})

recordingState.setBroadcast((snapshot) => {
  recordingService.emit('stateChanged', snapshot)
})

recordingState.setMaxDurationReached(() => {
  const mainWin = windowManager.get(WindowType.MAIN)
  if (mainWin && !mainWin.isDestroyed()) {
    recordingService.emit('showMaxDurationReached', undefined, mainWin)
  }
})

/** 手动 native 录音失败定向通知主窗（由录音页弹提示），主窗缺席回退系统通知 */
export function emitManualRecordingError(payload: ManualRecordingErrorPayload): void {
  const mainWin = windowManager.get(WindowType.MAIN)
  if (mainWin && !mainWin.isDestroyed()) {
    recordingService.emit('manualRecordingError', payload, mainWin)
    return
  }

  if (!Notification.isSupported()) {
    return
  }
  const body = `Recording failed${payload.detail
    ? `: ${payload.detail}`
    : ''}.`
  new Notification({ title: 'Recording', body }).show()
}

/** 手动 native 录音的完成 / 错误收尾：native 通用管线按 source 路由到这里 */
registerNativeRecordingHandlers('manual', {
  onComplete(session, _filePath, duration) {
    const mainWin = windowManager.get(WindowType.MAIN)
    if (!mainWin || mainWin.isDestroyed()) {
      console.warn('[recording] main window missing, skip manualRecordingComplete')
      return
    }

    recordingService.emit('manualRecordingComplete', {
      taskId: session.taskId,
      duration,
      mimeType: session.mimeType,
    }, mainWin)
  },
  onError(code, message) {
    emitManualRecordingError({ reason: 'recorder-error', detail: code, message })
  },
  onMicDegraded(detail) {
    recordingService.emit('micDegraded', { source: 'manual', detail })
  },
})

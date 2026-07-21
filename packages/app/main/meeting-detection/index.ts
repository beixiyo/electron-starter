import type { RecordingStatePayload } from '@ipc/services/meeting-detection/contract'
import type { BrowserWindow } from 'electron'
import type { MeetingSession } from './meeting-detector'
import { meetingDetectionService } from '@ipc/services/meeting-detection/service'
import { onRecorderEvent, stopRecorder } from '@main/audio-recorder'
import { initNativeRecordingPipeline } from '@main/native-recording'
import { recordingState } from '@main/recording-state'
import { WindowType } from '@shared'
import { app } from 'electron'
import { logicalWindowManager } from '../window-manager'
import { onMeetingEvent, startMeetingDetector, stopMeetingDetector } from './meeting-detector'

/**
 * MEETING_TOAST 弹窗当前正占用池窗口时返回该窗口，否则 undefined
 * getTargetWindow 已内含「route 指向 MEETING_TOAST 且窗口存活」的判断
 */
function getActiveToastWindow(): BrowserWindow | undefined {
  return logicalWindowManager.getTargetWindow(WindowType.MEETING_TOAST)
}

/** 以 route payload 展示 MEETING_TOAST 弹窗（不抢焦点），展示失败时告警 */
function showToast(routePayload: { type: 'detected' | 'recording-state', payload: unknown }): void {
  const win = logicalWindowManager.showInactive(WindowType.MEETING_TOAST, { payload: routePayload })
  if (!win)
    console.warn('[meeting-detection] failed to show meeting toast')
}

function emitToToast(eventName: 'detected' | 'ended', session: MeetingSession): void {
  const payload = {
    appId: session.appId,
    displayName: session.displayName,
    pid: session.pid,
  }
  const activeWin = getActiveToastWindow()

  if (eventName === 'ended') {
    if (activeWin)
      meetingDetectionService.emit('ended', payload, activeWin)
    logicalWindowManager.hide(WindowType.MEETING_TOAST)
    return
  }

  /** MEETING_TOAST 已在展示：向现有窗口推事件即可，重新 show 会换 token 导致 renderer 重挂载、计时等状态丢失 */
  if (activeWin) {
    meetingDetectionService.emit('detected', payload, activeWin)
    return
  }

  showToast({ type: 'detected', payload })
}

function emitRecordingState(payload: RecordingStatePayload): void {
  const activeWin = getActiveToastWindow()

  if (payload.status === 'stopped') {
    if (activeWin)
      meetingDetectionService.emit('recording-state', payload, activeWin)
    logicalWindowManager.hide(WindowType.MEETING_TOAST)
    return
  }

  if (activeWin) {
    meetingDetectionService.emit('recording-state', payload, activeWin)
    return
  }

  showToast({ type: 'recording-state', payload })
}

export function initMeetingDetection(): void {
  initNativeRecordingPipeline()

  onMeetingEvent((event) => {
    const label = event.type === 'meeting-confirmed'
      ? 'confirmed'
      : 'ended'
    console.log(`[meeting-detection] ${label}: ${event.session.displayName} pid=${event.session.pid}`)

    /** 手动 native 录音进行中不响应会议结束的自动停止，避免误停手动录音（共用同一子进程） */
    if (event.type === 'meeting-ended' && recordingState.nativeSource === 'meeting') {
      recordingState.stop()
    }

    emitToToast(event.type === 'meeting-confirmed'
      ? 'detected'
      : 'ended', event.session)
  })

  app.on('before-quit', () => {
    stopMeetingDetector()
    stopRecorder()
  })

  /**
   * 手动 native tap 录音与会议录音共用同一 audio-recorder 子进程：
   * 手动录音的 recorder 事件由 native-recording 管线处理，这里必须早退，
   * 否则会误弹会议 toast、把手动录音当会议录音重复存盘
   */
  onRecorderEvent('recording', ({ path }) => {
    if (recordingState.nativeSource !== 'meeting')
      return
    emitRecordingState({ status: 'recording', path })
  })
  onRecorderEvent('paused', ({ path }) => {
    if (recordingState.nativeSource !== 'meeting')
      return
    emitRecordingState({ status: 'paused', path })
  })
  onRecorderEvent('mixing', ({ path }) => {
    if (recordingState.nativeSource !== 'meeting')
      return
    emitRecordingState({ status: 'mixing', path })
  })
  onRecorderEvent('stopped', ({ path: filePath, duration }) => {
    if (recordingState.nativeSource !== 'meeting')
      return
    emitRecordingState({ status: 'stopped', path: filePath, duration })
  })

  onRecorderEvent('error', ({ code, detail }) => {
    if (recordingState.nativeSource !== 'meeting')
      return

    /** 回执噪声（重复 stop / 并发 start 被拒）与会议录音状态无关，不动 UI */
    if (code === 'not_recording' || code === 'already_recording')
      return

    console.warn(`[meeting-detection] recorder error: ${code}${detail
      ? ` (${detail})`
      : ''}`)

    /** 错误收尾统一由 native-recording 管线处理，避免重复 stop 或提前关闭 toast */
  })

  startMeetingDetector()
  console.log('[meeting-detection] started')
}

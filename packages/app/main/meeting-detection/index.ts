import type { RecordingStatePayload } from '@ipc/services/meeting-detection/contract'
import type { BrowserWindow } from 'electron'
import type { MeetingSession } from './meeting-detector'
import path from 'node:path'
import { meetingDetectionService } from '@ipc/services/meeting-detection/service'
import { getRecorderPid, onRecorderEvent, startRecorder, stopRecorder, stopRecording } from '@main/audio-recorder'
import { recordingState } from '@main/recording-state'
import { WindowType } from '@shared'
import { app } from 'electron'
import { logicalWindowManager, windowManager } from '../window-manager'
import { addSelfPidSource, onMeetingEvent, startMeetingDetector, stopMeetingDetector } from './meeting-detector'

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
  /** 「会议录制」自身的子进程同时占麦+系统音频，会被误判为会议，排除掉 */
  addSelfPidSource(() => {
    const pid = getRecorderPid()
    return pid
      ? [pid]
      : []
  })

  onMeetingEvent((event) => {
    const label = event.type === 'meeting-confirmed'
      ? 'confirmed'
      : 'ended'
    console.log(`[meeting-detection] ${label}: ${event.session.displayName} pid=${event.session.pid}`)

    /** 手动 native 录音进行中不响应会议结束的自动停止，避免误停手动录音（共用同一子进程） */
    if (event.type === 'meeting-ended' && recordingState.nativeSource !== 'manual') {
      stopRecording()
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
    if (recordingState.nativeSource === 'manual')
      return
    emitRecordingState({ status: 'recording', path })
  })
  onRecorderEvent('paused', ({ path }) => {
    if (recordingState.nativeSource === 'manual')
      return
    emitRecordingState({ status: 'paused', path })
  })
  onRecorderEvent('mixing', ({ path }) => {
    if (recordingState.nativeSource === 'manual')
      return
    emitRecordingState({ status: 'mixing', path })
  })
  onRecorderEvent('stopped', ({ path: filePath, duration }) => {
    if (recordingState.nativeSource === 'manual')
      return
    emitRecordingState({ status: 'stopped', path: filePath, duration })

    const mainWin = windowManager.get(WindowType.MAIN)
    if (mainWin && !mainWin.isDestroyed()) {
      const name = path.basename(filePath, path.extname(filePath))
      meetingDetectionService.emit('recording-complete', {
        name,
        path: filePath,
        duration,
        mimeType: 'audio/mp4',
      }, mainWin)
    }
  })

  onRecorderEvent('error', ({ code, detail }) => {
    if (recordingState.nativeSource === 'manual')
      return

    /** 回执噪声（重复 stop / 并发 start 被拒）与会议录音状态无关，不动 UI */
    if (code === 'not_recording' || code === 'already_recording')
      return

    console.warn(`[meeting-detection] recorder error: ${code}${detail
      ? ` (${detail})`
      : ''}`)

    /**
     * 采集中断（gap watchdog）：中断前样本仍在 writer 里，走正常 stop 挽救，
     * 随后真正的 stopped 事件会驱动 toast 收口并交付产物
     */
    if (code === 'audio_sample_timeout') {
      stopRecording()
      return
    }

    /**
     * 其余采集失败（无样本 / writer 失败等）：Swift 已删空文件且不再发 stopped，
     * 补一个 stopped 状态让 toast 收口，避免 UI 永远卡在录音态
     */
    emitRecordingState({ status: 'stopped' })
  })

  startRecorder()
  startMeetingDetector()
  console.log('[meeting-detection] started')
}

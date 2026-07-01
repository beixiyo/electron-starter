import type { RecordingStatePayload } from '@ipc/services/meeting-detection/contract'
import type { MeetingSession } from './meeting-detector'
import path from 'node:path'
import { meetingDetectionService } from '@ipc/services/meeting-detection/service'
import { getRecorderPid, onRecorderEvent, startRecorder, stopRecorder, stopRecording } from '@main/audio-recorder'
import { WindowType } from '@shared'
import { app } from 'electron'
import { logicalWindowManager, windowManager } from '../window-manager'
import { addSelfPidSource, onMeetingEvent, startMeetingDetector, stopMeetingDetector } from './meeting-detector'

function emitToToast(eventName: 'detected' | 'ended', session: MeetingSession): void {
  const payload = {
    appId: session.appId,
    displayName: session.displayName,
    pid: session.pid,
  }

  if (eventName === 'detected') {
    const wasActive = logicalWindowManager.isActive(WindowType.MEETING_TOAST)
    if (wasActive) {
      const win = logicalWindowManager.getTargetWindow(WindowType.MEETING_TOAST)
      if (win)
        meetingDetectionService.emit(eventName, payload, win)
      return
    }

    const win = logicalWindowManager.showInactive(WindowType.MEETING_TOAST, {
      payload: {
        type: 'detected',
        payload,
      },
    })
    if (!win)
      console.warn('[meeting-detection] failed to show meeting toast')
  }
  else {
    const win = logicalWindowManager.getTargetWindow(WindowType.MEETING_TOAST)
    if (win)
      meetingDetectionService.emit(eventName, payload, win)
    logicalWindowManager.hide(WindowType.MEETING_TOAST)
  }
}

function emitRecordingState(payload: RecordingStatePayload): void {
  if (payload.status === 'stopped') {
    const win = logicalWindowManager.getTargetWindow(WindowType.MEETING_TOAST)
    if (win)
      meetingDetectionService.emit('recording-state', payload, win)
    logicalWindowManager.hide(WindowType.MEETING_TOAST)
    return
  }

  const wasActive = logicalWindowManager.isActive(WindowType.MEETING_TOAST)
  if (wasActive) {
    const win = logicalWindowManager.getTargetWindow(WindowType.MEETING_TOAST)
    if (win)
      meetingDetectionService.emit('recording-state', payload, win)
    return
  }

  const win = logicalWindowManager.showInactive(WindowType.MEETING_TOAST, {
    payload: {
      type: 'recording-state',
      payload,
    },
  })
  if (!win)
    console.warn('[meeting-detection] failed to show recording toast')
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

    if (event.type === 'meeting-ended') {
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

  onRecorderEvent('recording', ({ path }) => {
    emitRecordingState({ status: 'recording', path })
  })
  onRecorderEvent('paused', ({ path }) => {
    emitRecordingState({ status: 'paused', path })
  })
  onRecorderEvent('mixing', ({ path }) => {
    emitRecordingState({ status: 'mixing', path })
  })
  onRecorderEvent('stopped', ({ path: filePath, duration }) => {
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

  startRecorder()
  startMeetingDetector()
  console.log('[meeting-detection] started')
}

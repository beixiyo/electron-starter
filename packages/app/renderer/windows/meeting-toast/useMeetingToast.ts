import type { MeetingDetectedPayload, RecordingStatePayload } from '@ipc/services/meeting-detection/contract'
import { WindowType } from '@shared'
import { useLatestCallback } from 'hooks'
import { animate, useMotionValue } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

const TOAST_DURATION_MS = 8000

export function useMeetingToast(initialEvent?: MeetingToastInitialEvent | null) {
  const [meeting, setMeeting] = useState<MeetingDetectedPayload | null>(null)
  const [recordingState, setRecordingState] = useState<RecordingStatePayload | null>(null)
  const [elapsed, setElapsed] = useState(0)

  /** 进度环走 MotionValue 直驱合成层，倒计时期间不触发 React 重渲染 */
  const progress = useMotionValue(1)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownAnimRef = useRef<ReturnType<typeof animate> | null>(null)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const elapsedStartRef = useRef(0)
  const totalPausedRef = useRef(0)
  const pausedAtRef = useRef(0)

  const clearCountdown = useLatestCallback(() => {
    countdownAnimRef.current?.stop()
    countdownAnimRef.current = null
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  })

  const clearElapsedTimer = useLatestCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  })

  const hideWindow = useLatestCallback(() => {
    clearCountdown()
    clearElapsedTimer()
    $ipc.window.hide(WindowType.MEETING_TOAST)
  })

  const startCountdown = useLatestCallback(() => {
    clearCountdown()
    progress.set(1)

    countdownAnimRef.current = animate(progress, 0, {
      duration: TOAST_DURATION_MS / 1000,
      ease: 'linear',
    })
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null
      handleDismiss()
    }, TOAST_DURATION_MS)
  })

  const tickElapsed = useLatestCallback(() => {
    const raw = Date.now() - elapsedStartRef.current - totalPausedRef.current
    setElapsed(Math.max(0, Math.floor(raw / 1000)))
  })

  const startElapsedTimer = useLatestCallback(() => {
    clearElapsedTimer()
    elapsedStartRef.current = Date.now()
    totalPausedRef.current = 0
    pausedAtRef.current = 0
    setElapsed(0)
    timerRef.current = setInterval(tickElapsed, 200)
  })

  const handleDismiss = useLatestCallback(() => {
    if (meeting) {
      $ipc.meetingDetection.dismiss(meeting.appId, meeting.pid)
    }
    setMeeting(null)
    hideWindow()
  })

  const handleStartRecording = useLatestCallback(() => {
    if (meeting) {
      $ipc.meetingDetection.startRecording(meeting.appId, meeting.pid)
    }
    clearCountdown()
  })

  const handlePause = useLatestCallback(() => {
    $ipc.meetingDetection.pauseRecording()
    pausedAtRef.current = Date.now()
    clearElapsedTimer()
  })

  const handleResume = useLatestCallback(() => {
    $ipc.meetingDetection.resumeRecording()
    if (pausedAtRef.current > 0) {
      totalPausedRef.current += Date.now() - pausedAtRef.current
      pausedAtRef.current = 0
    }
    timerRef.current = setInterval(tickElapsed, 200)
  })

  const handleStop = useLatestCallback(() => {
    $ipc.meetingDetection.stopRecording()
  })

  const applyDetected = useLatestCallback((payload: MeetingDetectedPayload) => {
    setMeeting(payload)
    setRecordingState(null)
    startCountdown()
  })

  const applyRecordingState = useLatestCallback((payload: RecordingStatePayload) => {
    setRecordingState(payload)

    if (payload.status === 'recording' && !timerRef.current) {
      startElapsedTimer()
    }
    else if (payload.status === 'mixing') {
      clearElapsedTimer()
    }
    else if (payload.status === 'stopped') {
      clearElapsedTimer()
      setMeeting(null)
      setRecordingState(null)
      hideWindow()
    }
  })

  useEffect(() => {
    if (!initialEvent)
      return

    if (initialEvent.type === 'detected') {
      applyDetected(initialEvent.payload)
      return
    }

    applyRecordingState(initialEvent.payload)
  }, [initialEvent])

  useEffect(() => {
    const unsubDetected = $ipc.meetingDetection.on('detected', (payload) => {
      applyDetected(payload)
    })

    const unsubEnded = $ipc.meetingDetection.on('ended', () => {
      setMeeting(null)
      setRecordingState(null)
      hideWindow()
    })

    const unsubRecording = $ipc.meetingDetection.on('recording-state', (payload) => {
      applyRecordingState(payload)
    })

    return () => {
      unsubDetected()
      unsubEnded()
      unsubRecording()
      clearCountdown()
      clearElapsedTimer()
    }
  }, [])

  return {
    meeting,
    progress,
    recordingState,
    elapsed,
    handleDismiss,
    handleStartRecording,
    handlePause,
    handleResume,
    handleStop,
  }
}

/**
 * Meeting Toast 首次挂载时由窗口池 route 携带的初始化事件
 */
export type MeetingToastInitialEvent
  = | {
    type: 'detected'
    payload: MeetingDetectedPayload
  }
  | {
    type: 'recording-state'
    payload: RecordingStatePayload
  }

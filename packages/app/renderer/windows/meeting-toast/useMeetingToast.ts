import type { MeetingDetectedPayload, RecordingStatePayload } from '@ipc/services/meeting-detection/contract'
import { WindowType } from '@shared'
import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'

const TOAST_DURATION_MS = 8000
const TICK_INTERVAL_MS = 50

export function useMeetingToast() {
  const [meeting, setMeeting] = useState<MeetingDetectedPayload | null>(null)
  const [progress, setProgress] = useState(1)
  const [recordingState, setRecordingState] = useState<RecordingStatePayload | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedStartRef = useRef(0)
  const totalPausedRef = useRef(0)
  const pausedAtRef = useRef(0)

  const clearCountdown = useLatestCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
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
    const start = Date.now()
    setProgress(1)

    countdownRef.current = setInterval(() => {
      const remaining = 1 - (Date.now() - start) / TOAST_DURATION_MS
      if (remaining <= 0) {
        setProgress(0)
        handleDismiss()
      }
      else {
        setProgress(remaining)
      }
    }, TICK_INTERVAL_MS)
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

  useEffect(() => {
    const unsubDetected = $ipc.meetingDetection.on('detected', (payload) => {
      setMeeting(payload)
      setRecordingState(null)
      startCountdown()
    })

    const unsubEnded = $ipc.meetingDetection.on('ended', () => {
      setMeeting(null)
      setRecordingState(null)
      hideWindow()
    })

    const unsubRecording = $ipc.meetingDetection.on('recording-state', (payload) => {
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

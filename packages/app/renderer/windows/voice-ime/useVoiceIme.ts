import type { VoiceImeReleaseResult } from '@shared'
import type { LiveWaveAudioProps, RecordingControls, VoiceRecorderStatus } from 'comps'
import { convertToWav, formatDuration } from '@jl-org/tool'
import { HOLD_MIN_DURATION_MS, HOLD_SHORT_ERROR_MESSAGE, SHORTCUTS, WindowType } from '@shared'
import { useGetState, useLatestCallback } from 'hooks'
import { useEffect, useMemo, useRef, useState } from 'react'

export function useVoiceIme() {
  const [status, setStatus] = useGetState<VoiceRecorderStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [durationSeconds, setDurationSeconds] = useState(0)

  const liveWaveRef = useRef<RecordingControls | null>(null)
  const recordingStartAtRef = useRef<number | null>(null)
  const recordedDurationMsRef = useRef(0)
  const pendingReleaseRef = useRef<{ duration: number } | null>(null)
  const recordingBlobRef = useRef<Blob | null>(null)
  const releaseErrorRef = useRef<string | null>(null)
  const releaseInFlightRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const isHoldingRef = useRef(false)

  const durationLabel = useMemo(() => formatDuration(durationSeconds), [durationSeconds])

  const startTimer = useLatestCallback(() => {
    if (timerRef.current !== null)
      return
    timerRef.current = window.setInterval(() => setDurationSeconds(prev => prev + 1), 1000)
  })

  const stopTimer = useLatestCallback(() => {
    if (timerRef.current === null)
      return
    window.clearInterval(timerRef.current)
    timerRef.current = null
  })

  const handleWaveformError = useLatestCallback((payload: Error) => {
    const message = payload?.message || '录音失败，请检查麦克风权限'
    setError(message)
    releaseErrorRef.current = message
    recordingBlobRef.current = null
    recordingStartAtRef.current = null
    recordedDurationMsRef.current = 0
    setStatus('idle')
    stopTimer()
  })

  const flushPendingResult = useLatestCallback(async () => {
    if (releaseInFlightRef.current)
      return
    const pending = pendingReleaseRef.current
    if (!pending)
      return
    const blob = recordingBlobRef.current
    const forcedError = releaseErrorRef.current
    if (!blob && !forcedError)
      return

    releaseInFlightRef.current = true
    try {
      if (!blob && forcedError) {
        const result: VoiceImeReleaseResult = { duration: pending.duration, error: forcedError }
        await $ipc.hold.release({ type: SHORTCUTS.HOLD_VOICE_IME.windowType, result })
      }
      else if (blob) {
        const wavBlob = await convertToWav(blob, { sampleRate: 16000, channels: 1 })
        const audioBuffer = await wavBlob.arrayBuffer()
        const result: VoiceImeReleaseResult = {
          duration: pending.duration,
          mimeType: wavBlob.type,
          size: wavBlob.size,
          audioBuffer,
        }
        await $ipc.hold.release({ type: SHORTCUTS.HOLD_VOICE_IME.windowType, result })
      }

      pendingReleaseRef.current = null
      recordingBlobRef.current = null
      releaseErrorRef.current = null
      recordedDurationMsRef.current = 0
      setDurationSeconds(0)
      if (!forcedError)
        setError(null)
      if (liveWaveRef.current)
        await liveWaveRef.current.destroy()
    }
    catch (err) {
      setError(err instanceof Error
        ? err.message
        : '录音发送失败')
      setStatus('idle')
    }
    finally {
      releaseInFlightRef.current = false
    }
  })

  const handleRecordingFinish = useLatestCallback((audioUrl: string, audioBlob: Blob) => {
    if (audioUrl)
      URL.revokeObjectURL(audioUrl)
    recordingBlobRef.current = audioBlob
    void flushPendingResult()
  })

  const startRecording = useLatestCallback(async () => {
    const controller = liveWaveRef.current
    if (!controller) { setError('音频组件尚未就绪'); return }
    if (controller.isRecording())
      return

    setError(null)
    releaseErrorRef.current = null
    recordingBlobRef.current = null
    recordedDurationMsRef.current = 0
    setDurationSeconds(0)
    recordingStartAtRef.current = Date.now()
    setStatus('recording')
    startTimer()
    try {
      await controller.start()
    }
    catch (err) {
      handleWaveformError(err as Error)
    }
  })

  const stopRecording = useLatestCallback(async () => {
    const controller = liveWaveRef.current
    if (!controller) {
      stopTimer()
      recordingStartAtRef.current = null
      return
    }
    if (controller.isRecording()) {
      try { await controller.stop() }
      catch (err) { handleWaveformError(err as Error) }
    }
    if (recordingStartAtRef.current) {
      recordedDurationMsRef.current = Math.max(Date.now() - recordingStartAtRef.current, 0)
    }
    recordingStartAtRef.current = null
    stopTimer()
  })

  const handleHoldStart = useLatestCallback(() => {
    if (isHoldingRef.current)
      return
    isHoldingRef.current = true
    void startRecording()
  })

  const handleHoldEnd = useLatestCallback(async () => {
    if (!isHoldingRef.current)
      return
    isHoldingRef.current = false
    setStatus(prev => prev === 'idle'
      ? 'idle'
      : 'processing')

    await stopRecording()
    const durationMs = recordedDurationMsRef.current
    const isTooShort = durationMs < HOLD_MIN_DURATION_MS
    if (!releaseErrorRef.current && (isTooShort || !recordingBlobRef.current)) {
      releaseErrorRef.current = HOLD_SHORT_ERROR_MESSAGE
      recordingBlobRef.current = null
    }
    pendingReleaseRef.current = { duration: durationMs }
    await flushPendingResult()
  })

  useEffect(() => {
    const cleanupStart = $ipc.hold.onStart((event) => {
      if (event.windowType === WindowType.VOICE_IME)
        handleHoldStart()
    })
    const cleanupEnd = $ipc.hold.onEnd((event) => {
      if (event.windowType === WindowType.VOICE_IME)
        handleHoldEnd()
    })
    return () => { cleanupStart(); cleanupEnd() }
  }, [])

  useEffect(() => {
    const registerStatusListener = $ipc.voiceIme?.onStatusChange
    if (!registerStatusListener)
      return
    return registerStatusListener(({ status: nextStatus, error: nextError }) => {
      if (nextStatus) {
        setStatus(nextStatus)
        if (nextStatus === 'idle')
          setDurationSeconds(0)
      }
      if (typeof nextError !== 'undefined')
        setError(nextError)
    })
  }, [])

  useEffect(() => {
    return () => {
      stopTimer()
      if (liveWaveRef.current)
        void liveWaveRef.current.destroy()
    }
  }, [])

  const liveWaveState: NonNullable<LiveWaveAudioProps['state']> = status === 'recording'
    ? 'recording'
    : status === 'processing'
      ? 'idle'
      : 'stop'

  return {
    status,
    error,
    durationLabel,
    liveWaveRef,
    liveWaveState,
    handleWaveformError,
    handleRecordingFinish,
  }
}

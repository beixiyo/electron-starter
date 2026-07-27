import type { VoiceImeCancelPayload } from '@ipc/services/voice-ime/contract'
import type { VoiceImeReleaseResult } from '@shared'
import type { LiveWaveAudioProps, RecordingControls, VoiceRecorderStatus } from 'comps'
import { convertToWav, formatDuration } from '@jl-org/tool'
import { HOLD_MIN_DURATION_MS, HOLD_SHORT_ERROR_MESSAGE, VOICE_IME_MAX_RECORDING_DURATION_MS, WindowType } from '@shared'
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
  const maxRecordingTimerRef = useRef<number | null>(null)
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

  const clearMaxRecordingTimer = useLatestCallback(() => {
    if (maxRecordingTimerRef.current === null)
      return
    window.clearTimeout(maxRecordingTimerRef.current)
    maxRecordingTimerRef.current = null
  })

  const handleWaveformError = useLatestCallback((payload: Error) => {
    clearMaxRecordingTimer()
    void liveWaveRef.current?.destroy()
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
        await $ipc.window.release(WindowType.VOICE_IME, result)
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
        await $ipc.window.release(WindowType.VOICE_IME, result)
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
      await liveWaveRef.current?.destroy()
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
    setStatus('recording')
    startTimer()
    try {
      await controller.start()

      /**
       * getUserMedia 尚未完成时用户可能已经松开快捷键
       *
       * 迟到的 start 没有后续 release 可以关闭，必须在这里立即回收 MediaStream
       */
      if (!isHoldingRef.current) {
        await controller.destroy()
        return
      }

      recordingStartAtRef.current = Date.now()
      clearMaxRecordingTimer()
      maxRecordingTimerRef.current = window.setTimeout(() => {
        maxRecordingTimerRef.current = null
        void handleHoldEnd(true)
      }, VOICE_IME_MAX_RECORDING_DURATION_MS)
    }
    catch (err) {
      handleWaveformError(err as Error)
    }
  })

  const stopRecording = useLatestCallback(async () => {
    clearMaxRecordingTimer()
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

  const handleHoldEnd = useLatestCallback(async (force = false) => {
    if (!isHoldingRef.current && !force)
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

  const handleSystemCancel = useLatestCallback((reason: VoiceImeCancelPayload['reason']) => {
    isHoldingRef.current = false
    pendingReleaseRef.current = null
    recordingBlobRef.current = null
    releaseErrorRef.current = null
    recordingStartAtRef.current = null
    recordedDurationMsRef.current = 0
    releaseInFlightRef.current = false

    stopTimer()
    clearMaxRecordingTimer()
    setDurationSeconds(0)
    setError(null)
    setStatus('idle')
    void liveWaveRef.current?.destroy()

    console.info(`[voice-ime] cancelled: ${reason}`)
  })

  useEffect(() => {
    const cleanupStart = $ipc.hold.on('start', (event) => {
      if (event.windowType === WindowType.VOICE_IME)
        handleHoldStart()
    })
    const cleanupEnd = $ipc.hold.on('end', (event) => {
      if (event.windowType === WindowType.VOICE_IME)
        handleHoldEnd()
    })
    return () => { cleanupStart(); cleanupEnd() }
  }, [])

  useEffect(() => {
    return $ipc.voiceIme.on('status', ({ status: nextStatus, error: nextError }) => {
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
    return $ipc.voiceIme.on('cancel', ({ reason }) => {
      handleSystemCancel(reason)
    })
  }, [])

  useEffect(() => {
    return () => {
      stopTimer()
      clearMaxRecordingTimer()
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

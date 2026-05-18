import type { VoiceImeReleaseResult } from '@shared'
import type { RecordingControls, VoiceRecorderStatus } from 'comps'
import { convertToWav, formatDuration } from '@jl-org/tool'
import { HOLD_MIN_DURATION_MS, HOLD_SHORT_ERROR_MESSAGE, SHORTCUTS, WindowType } from '@shared'
import { VOICE_IME_SIZE } from '@shared/window-config/constants'
import { LiveWaveAudio } from 'comps'
import { useTheme } from 'hooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from 'utils'

export function VoiceImeApp(): React.JSX.Element {
  useTheme()
  const [status, setStatus] = useState<VoiceRecorderStatus>('idle')
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

  const startTimer = useCallback(() => {
    if (timerRef.current !== null) {
      return
    }
    timerRef.current = window.setInterval(() => {
      setDurationSeconds(prev => prev + 1)
    }, 1000)
  }, [])

  const stopTimer = useCallback(() => {
    if (timerRef.current === null) {
      return
    }
    window.clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  const handleWaveformError = useCallback((payload: Error) => {
    const message = payload?.message || '录音失败，请检查麦克风权限'
    setError(message)
    releaseErrorRef.current = message
    recordingBlobRef.current = null
    recordingStartAtRef.current = null
    recordedDurationMsRef.current = 0
    setStatus('idle')
    stopTimer()
  }, [stopTimer])

  const startRecording = useCallback(async () => {
    const controller = liveWaveRef.current
    if (!controller) {
      setError('音频组件尚未就绪')
      return
    }
    if (controller.isRecording()) {
      return
    }
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
  }, [handleWaveformError, startTimer])

  const stopRecording = useCallback(async () => {
    const controller = liveWaveRef.current
    if (!controller) {
      stopTimer()
      recordingStartAtRef.current = null
      return
    }
    if (controller.isRecording()) {
      try {
        await controller.stop()
      }
      catch (err) {
        handleWaveformError(err as Error)
      }
    }
    if (recordingStartAtRef.current) {
      recordedDurationMsRef.current = Math.max(Date.now() - recordingStartAtRef.current, 0)
    }
    recordingStartAtRef.current = null
    stopTimer()
  }, [handleWaveformError, stopTimer])

  const flushPendingResult = useCallback(async () => {
    if (releaseInFlightRef.current) {
      return
    }
    const pending = pendingReleaseRef.current
    if (!pending) {
      return
    }
    const blob = recordingBlobRef.current
    const forcedError = releaseErrorRef.current
    if (!blob && !forcedError) {
      return
    }
    releaseInFlightRef.current = true
    try {
      if (!blob && forcedError) {
        const result: VoiceImeReleaseResult = {
          duration: pending.duration,
          error: forcedError,
        }
        await $ipc.hold.release({
          type: SHORTCUTS.HOLD_VOICE_IME.windowType,
          result,
        })
      }
      else if (blob) {
        const wavBlob = await convertToWav(blob, {
          sampleRate: 16000,
          channels: 1,
        })

        const audioBuffer = await wavBlob.arrayBuffer()
        const result: VoiceImeReleaseResult = {
          duration: pending.duration,
          mimeType: wavBlob.type,
          size: wavBlob.size,
          audioBuffer,
        }
        await $ipc.hold.release({
          type: SHORTCUTS.HOLD_VOICE_IME.windowType,
          result,
        })
      }

      pendingReleaseRef.current = null
      recordingBlobRef.current = null
      releaseErrorRef.current = null
      recordedDurationMsRef.current = 0

      setDurationSeconds(0)
      if (!forcedError) {
        setError(null)
      }
      if (liveWaveRef.current) {
        await liveWaveRef.current.destroy()
      }
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
  }, [])

  const handleRecordingFinish = useCallback((audioUrl: string, audioBlob: Blob, _chunks: Blob[]) => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
    }
    recordingBlobRef.current = audioBlob
    void flushPendingResult()
  }, [flushPendingResult])

  const handleHoldStart = useCallback(() => {
    if (isHoldingRef.current) {
      return
    }
    isHoldingRef.current = true
    void startRecording()
  }, [startRecording])

  const handleHoldEnd = useCallback(async () => {
    if (!isHoldingRef.current) {
      return
    }
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
    pendingReleaseRef.current = {
      duration: durationMs,
    }

    await flushPendingResult()
  }, [flushPendingResult, stopRecording])

  useEffect(() => {
    const cleanupStart = $ipc.hold.onStart((event) => {
      if (event.windowType === WindowType.VOICE_IME) {
        handleHoldStart()
      }
    })

    const cleanupEnd = $ipc.hold.onEnd((event) => {
      if (event.windowType === WindowType.VOICE_IME) {
        handleHoldEnd()
      }
    })

    return () => {
      cleanupStart()
      cleanupEnd()
    }
  }, [handleHoldEnd, handleHoldStart])

  useEffect(() => {
    return () => {
      stopTimer()
      if (liveWaveRef.current) {
        void liveWaveRef.current.destroy()
      }
    }
  }, [stopTimer])

  useEffect(() => {
    const registerStatusListener = $ipc.voiceIme?.onStatusChange
    if (!registerStatusListener) {
      return
    }
    const cleanup = registerStatusListener(({ status: nextStatus, error: nextError }) => {
      if (nextStatus) {
        setStatus(nextStatus)
        if (nextStatus === 'idle') {
          setDurationSeconds(0)
        }
      }
      if (typeof nextError !== 'undefined') {
        setError(nextError)
      }
    })
    return cleanup
  }, [])

  const liveWaveState = status === 'recording'
    ? 'recording'
    : status === 'processing'
      ? 'idle'
      : 'stop'

  const statusMeta = useMemo(() => {
    switch (status) {
      case 'recording':
        return {
          indicator: 'bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.6)] animate-pulse',
        }
      case 'processing':
        return {
          indicator: 'bg-sky-400 shadow-[0_0_12px_rgba(14,165,233,0.6)] animate-pulse',
        }
      default:
        return {
          indicator: 'bg-gray-500',
        }
    }
  }, [status])

  return (
    <div
      className={ cn(
        'relative flex justify-center items-center overflow-hidden',
        'bg-background/90 text-textPrimary backdrop-blur-xl rounded-2xl',
        'shadow-2xl shadow-black/20 border border-white/10',
      ) }
      style={ {
        width: VOICE_IME_SIZE.WIDTH,
        height: VOICE_IME_SIZE.HEIGHT,
      } }
    >
      <div className="w-full flex flex-col items-center justify-center gap-3 p-4">
        <div className="flex items-center justify-center gap-2 w-full h-6">
          <div
            className={ cn(
              'rounded-full transition-all duration-300 ease-in-out w-3 h-3',
              statusMeta.indicator,
            ) }
          />
          <span className="text-xs">{ durationLabel }</span>
        </div>

        <LiveWaveAudio
          ref={ liveWaveRef }
          state={ liveWaveState }
          onError={ handleWaveformError }
          onRecordingFinish={ handleRecordingFinish }
          preferredMimeTypes={ [
            'audio/webm;codecs=opus',
          ] }
        />
      </div>

      { error && (
        <div className={ cn(
          'absolute inset-0 z-10 flex items-center justify-center',
          'bg-background/95 backdrop-blur-xl rounded-2xl',
        ) }>
          <span className="text-xs text-red-300">{ error }</span>
        </div>
      ) }
    </div>
  )
}

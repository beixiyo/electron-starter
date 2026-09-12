/** 浏览器 MediaRecorder 采集适配器；每个 session 独立持有流、录音器和音量分析器。 */
import type { VoiceCaptureAdapter, VoiceCaptureCancelContext, VoiceCaptureContext } from './types'

/** 创建一个真实麦克风采集器；停止返回本轮 Blob，取消和销毁只负责释放资源。 */
export function createMediaRecorderCapture(): VoiceCaptureAdapter {
  const recordings = new Map<string, Recording>()
  const starts = new Map<string, StartRequest>()
  let currentSessionId: string | null = null
  let destroyed = false
  let destroyPromise: Promise<void> | null = null

  function start(context: VoiceCaptureContext): Promise<void> {
    if (destroyed) return Promise.reject(new Error('Voice capture has been destroyed'))

    if (context.signal.aborted) return Promise.resolve()

    const existing = starts.get(context.sessionId)
    if (existing) return existing.promise

    const active = recordings.get(context.sessionId)
    if (active && !active.disposed) return Promise.resolve()

    const request = {
      sessionId: context.sessionId,
      context,
      canceled: false,
      recording: null,
      promise: Promise.resolve(),
    } satisfies StartRequest
    starts.set(context.sessionId, request)
    request.promise = beginStart(request)
    return request.promise
  }

  async function beginStart(request: StartRequest): Promise<void> {
    let stream: MediaStream | null = null

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (isCanceled(request)) {
        stopTracks(stream)
        return
      }

      const recorder = new MediaRecorder(stream)
      const recording = createRecording(request, stream, recorder)
      request.recording = recording
      recordings.set(request.sessionId, recording)
      currentSessionId = request.sessionId

      try {
        recorder.start()
      }
      catch (error) {
        await disposeRecording(recording)
        throw toError(error, 'Unable to start voice recorder')
      }
    }
    catch (error) {
      if (stream && !request.recording) stopTracks(stream)
      if (isCanceled(request)) return
      throw toError(error, 'Unable to access microphone')
    }
    finally {
      if (starts.get(request.sessionId) === request) starts.delete(request.sessionId)
    }
  }

  function createRecording(
    request: StartRequest,
    stream: MediaStream,
    recorder: MediaRecorder,
  ): Recording {
    const recording: Recording = {
      sessionId: request.sessionId,
      stream,
      recorder,
      chunks: [],
      level: createAudioLevelMeter(stream),
      abortCleanup: () => {},
      stopPromise: null,
      stopResolve: null,
      stopReject: null,
      stopSettled: false,
      recordingError: null,
      cancelPromise: null,
      disposePromise: null,
      disposed: false,
    }

    const onAbort = (): void => {
      request.canceled = true
      void cancelRecording(recording).catch(() => {})
    }
    request.context.signal.addEventListener('abort', onAbort, { once: true })
    recording.abortCleanup = () => request.context.signal.removeEventListener('abort', onAbort)

    recorder.ondataavailable = (event) => {
      if (!recording.disposed && event.data.size > 0) recording.chunks.push(event.data)
    }
    recorder.onerror = (event) => {
      const error = toError(event.error, 'MediaRecorder failed')
      recording.recordingError = error
      if (recording.stopPromise) settleStopFailure(recording, error)
    }
    recorder.onstop = () => {
      if (recording.stopPromise && !recording.recordingError) settleStopSuccess(recording)
    }

    return recording
  }

  async function stop(context: VoiceCaptureContext): Promise<Blob> {
    const pending = starts.get(context.sessionId)
    if (pending) {
      try {
        await pending.promise
      }
      catch {
        return emptyBlob()
      }
      return stop(context)
    }

    const recording = recordings.get(context.sessionId)
    if (!recording || recording.disposed) return emptyBlob()
    if (recording.stopPromise) return recording.stopPromise

    let resolveStop!: (blob: Blob) => void
    let rejectStop!: (error: Error) => void
    const stopPromise = new Promise<Blob>((resolve, reject) => {
      resolveStop = resolve
      rejectStop = reject
    })
    recording.stopPromise = stopPromise
    recording.stopResolve = resolveStop
    recording.stopReject = rejectStop

    if (recording.recordingError) {
      settleStopFailure(recording, recording.recordingError)
      return stopPromise
    }

    if (recording.recorder.state === 'inactive') {
      settleStopSuccess(recording)
      return stopPromise
    }

    try {
      recording.recorder.stop()
    }
    catch (error) {
      settleStopFailure(recording, toError(error, 'Unable to stop voice recorder'))
    }

    return stopPromise
  }

  async function cancel(context: VoiceCaptureCancelContext): Promise<void> {
    const pending = starts.get(context.sessionId)
    if (pending) {
      pending.canceled = true
      await pending.promise.catch(() => {})
    }

    const recording = recordings.get(context.sessionId)
    if (recording) await cancelRecording(recording)
  }

  function destroy(): Promise<void> {
    if (destroyPromise) return destroyPromise

    destroyed = true
    destroyPromise = (async () => {
      const pending = [...starts.values()]
      for (const request of pending) request.canceled = true
      await Promise.all(pending.map((request) => request.promise.catch(() => {})))

      const active = [...recordings.values()]
      await Promise.all(active.map((recording) => cancelRecording(recording)))
    })()
    return destroyPromise
  }

  return {
    start,
    stop,
    cancel,
    destroy,
    getAudioLevel: () => {
      const recording = currentSessionId
        ? recordings.get(currentSessionId)
        : undefined
      return recording && !recording.disposed
        ? recording.level.read()
        : 0
    },
  }

  function isCanceled(request: StartRequest): boolean {
    return request.canceled
      || request.context.signal.aborted
      || destroyed
      || starts.get(request.sessionId) !== request
  }

  function settleStopSuccess(recording: Recording): void {
    if (recording.stopSettled) return
    recording.stopSettled = true
    const blob = toBlob(recording)
    void disposeRecording(recording).then(() => {
      recording.stopResolve?.(blob)
      clearStopHandlers(recording)
    })
  }

  function settleStopFailure(recording: Recording, error: Error): void {
    if (recording.stopSettled) return
    recording.stopSettled = true
    void disposeRecording(recording).then(() => {
      recording.stopReject?.(error)
      clearStopHandlers(recording)
    })
  }

  async function cancelRecording(recording: Recording): Promise<void> {
    if (recording.cancelPromise) return recording.cancelPromise

    recording.cancelPromise = (async () => {
      if (recording.stopPromise && !recording.stopSettled) {
        settleStopFailure(recording, new Error('Voice capture canceled'))
        await recording.disposePromise
        return
      }

      clearRecorderHandlers(recording)
      try {
        if (recording.recorder.state !== 'inactive') recording.recorder.stop()
      }
      catch {
        /** 取消时无须保留 Blob；无论 MediaRecorder 是否已停止都释放轨道。 */
      }
      await disposeRecording(recording)
    })()
    return recording.cancelPromise
  }

  function clearStopHandlers(recording: Recording): void {
    recording.stopResolve = null
    recording.stopReject = null
  }

  function clearRecorderHandlers(recording: Recording): void {
    recording.recorder.ondataavailable = null
    recording.recorder.onerror = null
    recording.recorder.onstop = null
  }

  function disposeRecording(recording: Recording): Promise<void> {
    if (recording.disposePromise) return recording.disposePromise

    recording.disposed = true
    clearRecorderHandlers(recording)
    recording.abortCleanup()
    if (recordings.get(recording.sessionId) === recording) recordings.delete(recording.sessionId)
    if (currentSessionId === recording.sessionId) currentSessionId = null

    recording.disposePromise = (async () => {
      stopTracks(recording.stream)
      await recording.level.dispose()
    })()
    return recording.disposePromise
  }
}

function createAudioLevelMeter(stream: MediaStream): AudioLevelMeter {
  const AudioContextCtor = getAudioContextConstructor()
  if (!AudioContextCtor) return silentAudioLevelMeter()

  let context: AudioContextLike | null = null
  let source: AudioSourceLike
  let analyser: AudioAnalyserLike

  try {
    context = new AudioContextCtor()
    analyser = context.createAnalyser()
    analyser.fftSize = 256
    source = context.createMediaStreamSource(stream)
    source.connect(analyser)
  }
  catch {
    try {
      void context?.close().catch(() => {})
    }
    catch {
      /** AudioContext cleanup is best effort. */
    }
    return silentAudioLevelMeter()
  }

  const buffer = new Uint8Array(analyser.fftSize)
  return {
    read: () => {
      try {
        analyser.getByteTimeDomainData(buffer)
        let squareSum = 0
        for (const value of buffer) {
          const amplitude = (value - 128) / 128
          squareSum += amplitude * amplitude
        }
        return Math.sqrt(squareSum / buffer.length)
      }
      catch {
        return 0
      }
    },
    dispose: async () => {
      try {
        source.disconnect()
      }
      catch {
        /** AudioContext cleanup is best effort. */
      }
      try {
        analyser.disconnect()
      }
      catch {
        /** AudioContext cleanup is best effort. */
      }
      try {
        await context!.close()
      }
      catch {
        /** AudioContext cleanup is best effort. */
      }
    },
  }
}

function getAudioContextConstructor(): AudioContextConstructor | undefined {
  const scope = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor
  }
  return scope.AudioContext as unknown as AudioContextConstructor | undefined
    ?? scope.webkitAudioContext
}

function silentAudioLevelMeter(): AudioLevelMeter {
  return {
    read: () => 0,
    dispose: async () => {},
  }
}

function toBlob(recording: Recording): Blob {
  return new Blob(recording.chunks, { type: recording.recorder.mimeType || 'audio/webm' })
}

function emptyBlob(): Blob {
  return new Blob([], { type: 'audio/webm' })
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop()
    }
    catch {
      /** A failed track stop must not prevent the remaining tracks from releasing. */
    }
  }
}

function toError(value: unknown, fallback: string): Error {
  return value instanceof Error
    ? value
    : new Error(fallback)
}

type Recording = {
  sessionId: string
  stream: MediaStream
  recorder: MediaRecorder
  chunks: BlobPart[]
  level: AudioLevelMeter
  abortCleanup: () => void
  stopPromise: Promise<Blob> | null
  stopResolve: ((blob: Blob) => void) | null
  stopReject: ((error: Error) => void) | null
  stopSettled: boolean
  recordingError: Error | null
  cancelPromise: Promise<void> | null
  disposePromise: Promise<void> | null
  disposed: boolean
}

type StartRequest = {
  sessionId: string
  context: VoiceCaptureContext
  canceled: boolean
  recording: Recording | null
  promise: Promise<void>
}

type AudioLevelMeter = {
  read: () => number
  dispose: () => Promise<void>
}

type AudioAnalyserLike = {
  fftSize: number
  getByteTimeDomainData: (array: Uint8Array) => void
  disconnect: () => void
}

type AudioSourceLike = {
  connect: (destination: AudioAnalyserLike) => void
  disconnect: () => void
}

type AudioContextLike = {
  createAnalyser: () => AudioAnalyserLike
  createMediaStreamSource: (stream: MediaStream) => AudioSourceLike
  close: () => Promise<void>
}

type AudioContextConstructor = new() => AudioContextLike

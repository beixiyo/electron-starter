/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMediaRecorderCapture } from './mediaRecorderCapture'
import type { VoiceCaptureContext } from './types'

type FakeTrack = {
  stop: ReturnType<typeof vi.fn>
}

type FakeStream = {
  getTracks: () => FakeTrack[]
}

type FakeRecorder = {
  stream: FakeStream
  state: 'inactive' | 'recording'
  mimeType: string
  stop: ReturnType<typeof vi.fn>
  emitData: (data: Blob) => void
  emitStop: () => void
  emitError: (error: Error) => void
}

const harness = vi.hoisted(() => ({
  getUserMedia: vi.fn(),
  recorders: [] as FakeRecorder[],
  analysers: [] as FakeAnalyser[],
}))

class FakeAnalyser {
  fftSize = 4
  getByteTimeDomainData = vi.fn((buffer: Uint8Array) => {
    buffer.set([128, 192, 128, 64])
    return buffer
  })
  disconnect = vi.fn()
}

class FakeAudioContext {
  createAnalyser(): FakeAnalyser {
    const analyser = new FakeAnalyser()
    harness.analysers.push(analyser)
    return analyser
  }

  createMediaStreamSource(): { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> } {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
  }

  close = vi.fn(async () => {})
}

class FakeMediaRecorder {
  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((event: { error: Error }) => void) | null = null
  stop = vi.fn(() => {
    this.state = 'inactive'
  })

  constructor(public readonly stream: FakeStream) {
    const recorder = this as unknown as FakeRecorder
    recorder.emitData = (data) => this.ondataavailable?.({ data })
    recorder.emitStop = () => this.onstop?.()
    recorder.emitError = (error) => this.onerror?.({ error })
    harness.recorders.push(recorder)
  }

  start(): void {
    this.state = 'recording'
  }
}

vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
vi.stubGlobal('AudioContext', FakeAudioContext)

describe('createMediaRecorderCapture', () => {
  beforeEach(() => {
    harness.getUserMedia.mockReset()
    harness.recorders.length = 0
    harness.analysers.length = 0
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: harness.getUserMedia },
    })
  })

  it('pending start 被取消后，迟到的流不会创建录音器且会释放轨道', async () => {
    const lateStream = createStream()
    const nextStream = createStream()
    const late = deferred<FakeStream>()
    const next = deferred<FakeStream>()
    harness.getUserMedia
      .mockReturnValueOnce(late.promise)
      .mockReturnValueOnce(next.promise)
    const capture = createMediaRecorderCapture()
    const first = context('first')

    const firstStart = capture.start(first)
    const firstCancel = capture.cancel?.({ sessionId: first.sessionId })
    const secondCancel = capture.cancel?.({ sessionId: first.sessionId })
    const secondStart = capture.start(context('second'))

    late.resolve(lateStream)
    next.resolve(nextStream)
    await Promise.all([firstStart, firstCancel, secondCancel, secondStart])

    expect(lateStream.getTracks()[0].stop).toHaveBeenCalledOnce()
    expect(harness.recorders).toHaveLength(1)
    expect(harness.recorders[0].stream).toBe(nextStream)

    await capture.destroy?.()
  })

  it('destroy 会阻止迟到流建立录音器，并且可重复调用', async () => {
    const stream = createStream()
    const pending = deferred<FakeStream>()
    harness.getUserMedia.mockReturnValue(pending.promise)
    const capture = createMediaRecorderCapture()
    const start = capture.start(context('pending'))

    const firstDestroy = capture.destroy?.()
    const secondDestroy = capture.destroy?.()
    pending.resolve(stream)
    await Promise.all([start, firstDestroy, secondDestroy])

    expect(stream.getTracks()[0].stop).toHaveBeenCalledOnce()
    expect(harness.recorders).toHaveLength(0)
  })

  it('stop 的 onerror 会结算 Promise、释放资源并保留错误', async () => {
    const stream = createStream()
    harness.getUserMedia.mockResolvedValue(stream)
    const capture = createMediaRecorderCapture()
    const current = context('error')
    await capture.start(current)

    const recorder = harness.recorders[0]
    const stopping = capture.stop(current)
    recorder.emitError(new Error('encoder failed'))

    await expect(stopping).rejects.toThrow('encoder failed')
    expect(stream.getTracks()[0].stop).toHaveBeenCalledOnce()
    expect(await capture.stop(current)).toEqual(new Blob([], { type: 'audio/webm' }))
  })

  it('stop 返回本轮 Blob，并在录音期间提供非零音量', async () => {
    const stream = createStream()
    harness.getUserMedia.mockResolvedValue(stream)
    const capture = createMediaRecorderCapture()
    const current = context('recording')
    await capture.start(current)

    expect(capture.getAudioLevel?.()).toBeGreaterThan(0)
    const recorder = harness.recorders[0]
    recorder.emitData(new Blob(['audio'], { type: 'audio/webm' }))
    const stopping = capture.stop(current)
    recorder.emitStop()
    const blob = await stopping

    expect(await blob.text()).toBe('audio')
    expect(stream.getTracks()[0].stop).toHaveBeenCalledOnce()
    expect(capture.getAudioLevel?.()).toBe(0)
  })
})

function createStream(): FakeStream {
  const track = { stop: vi.fn() }
  return {
    getTracks: () => [track],
  }
}

function context(sessionId: string): VoiceCaptureContext {
  return {
    sessionId,
    signal: new AbortController().signal,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initNativeRecordingPipeline } from '.'
import { recordingState } from '../recording-state'
import {
  clearNativeRecordingSession,
  peekNativeRecordingSession,
  setNativeRecordingSession,
} from './session'

const harness = vi.hoisted(() => ({
  listeners: {} as Record<string, (payload: unknown) => void>,
  deleteRecoveryRecording: vi.fn(() => Promise.resolve()),
  stopRecording: vi.fn(),
}))

vi.mock('@main/audio-recorder', () => ({
  onRecorderEvent: vi.fn((event: string, listener: (payload: unknown) => void) => {
    harness.listeners[event] = listener
    return () => {}
  }),
  pauseRecording: vi.fn(),
  resumeRecording: vi.fn(),
  startRecorder: vi.fn(),
  stopRecorder: vi.fn(),
  stopRecording: harness.stopRecording,
}))

vi.mock('@main/recording-recovery', () => ({
  deleteRecoveryRecording: harness.deleteRecoveryRecording,
}))

vi.mock('electron', () => ({
  app: { on: vi.fn() },
}))

describe('native 录音启动代际', () => {
  beforeAll(() => {
    initNativeRecordingPipeline()
  })

  afterEach(() => {
    recordingState.finishNative()
    clearNativeRecordingSession()
    vi.clearAllMocks()
  })

  it('只接受当前会话路径的 ready 回执', () => {
    const session = createSession('current.m4a')
    setNativeRecordingSession(session)
    recordingState.startManualNative()

    harness.listeners.recording?.({ path: 'stale.m4a' })
    expect(recordingState.snapshot.phase).toBe('starting')

    harness.listeners.recording?.({ path: session.outputPath })
    expect(recordingState.snapshot.phase).toBe('recording')
  })

  it('启动期取消后遇到启动错误会清理会话和恢复资产', () => {
    const session = createSession('canceled.m4a')
    setNativeRecordingSession(session)
    recordingState.startManualNative()
    recordingState.reset()

    expect(harness.stopRecording).toHaveBeenCalledOnce()
    harness.listeners.error?.({ code: 'device_failed', terminal: false })

    expect(peekNativeRecordingSession()).toBeNull()
    expect(harness.deleteRecoveryRecording).toHaveBeenCalledWith(session.taskId)
    expect(recordingState.snapshot.phase).toBe('idle')
  })

  it('已开始采集后取消会等 stopped 再删除产物', async () => {
    const session = createSession('active.m4a')
    setNativeRecordingSession(session)
    recordingState.startManualNative()
    harness.listeners.recording?.({ path: session.outputPath })
    recordingState.reset()

    harness.listeners.error?.({ code: 'audio_sample_timeout', terminal: false })
    expect(peekNativeRecordingSession()).toEqual(session)
    expect(harness.deleteRecoveryRecording).not.toHaveBeenCalled()

    await Promise.resolve(harness.listeners.stopped?.({
      path: session.outputPath,
      duration: 1,
    }))
    expect(peekNativeRecordingSession()).toBeNull()
    expect(harness.deleteRecoveryRecording).toHaveBeenCalledWith(session.taskId)
  })

  it('已开始采集后取消会在 terminal error 后清理产物', () => {
    const session = createSession('terminal-error.m4a')
    setNativeRecordingSession(session)
    recordingState.startManualNative()
    harness.listeners.recording?.({ path: session.outputPath })
    recordingState.reset()

    harness.listeners.error?.({
      code: 'writer_failed',
      path: session.outputPath,
      terminal: true,
    })

    expect(peekNativeRecordingSession()).toBeNull()
    expect(harness.deleteRecoveryRecording).toHaveBeenCalledWith(session.taskId)
  })
})

function createSession(outputPath: string) {
  return {
    source: 'manual' as const,
    mimeType: 'audio/mp4',
    taskId: '00000000-0000-4000-8000-000000000001',
    outputPath,
  }
}

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initNativeRecordingPipeline, registerNativeRecordingHandlers } from '.'
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
  forceRestartRecorder: vi.fn(() => Promise.resolve()),
}))

vi.mock('@main/audio-recorder', () => ({
  onRecorderEvent: vi.fn((event: string, listener: (payload: unknown) => void) => {
    harness.listeners[event] = listener
    return () => {}
  }),
  pauseRecording: vi.fn(),
  forceRestartRecorder: harness.forceRestartRecorder,
  resumeRecording: vi.fn(),
  startRecorder: vi.fn(),
  stopRecorder: vi.fn(),
  stopRecording: harness.stopRecording,
  /** 管线初始化末尾会发起启动预检，返回具名结果对象 */
  probeMicCaptureStrategy: vi.fn(() => Promise.resolve({ ready: true })),
}))

vi.mock('@main/recording-recovery', () => ({
  deleteRecoveryRecording: harness.deleteRecoveryRecording,
}))

/**
 * 管线初始化会一路走到权限探测与窗口工厂，用到的 electron 成员都要给出来，
 * 少一个就会以「No X export is defined on the electron mock」整套 skip
 */
vi.mock('electron', () => ({
  app: { on: vi.fn(), getPath: vi.fn(() => '/tmp'), whenReady: vi.fn(() => Promise.resolve()) },
  systemPreferences: { getMediaAccessStatus: vi.fn(() => 'granted') },
  screen: { getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } })) },
  BrowserWindow: class {
    static getAllWindows = vi.fn(() => [])
    on = vi.fn()
    once = vi.fn()
    isDestroyed = vi.fn(() => false)
  },
}))

describe('native 录音启动代际', () => {
  beforeAll(() => {
    initNativeRecordingPipeline()
  })

  afterEach(() => {
    recordingState.finishNative()
    clearNativeRecordingSession()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('helper 没有 ready 回执时会退出 starting 并重建 helper', async () => {
    vi.useFakeTimers()
    const onError = vi.fn()
    registerNativeRecordingHandlers('manual', {
      onComplete: vi.fn(),
      onError,
    })
    const session = createSession('never-ready.m4a')
    setNativeRecordingSession(session)
    recordingState.startManualNative()

    await vi.advanceTimersByTimeAsync(20_000)
    await Promise.resolve()

    expect(recordingState.snapshot.phase).toBe('idle')
    expect(peekNativeRecordingSession()).toBeNull()
    expect(onError).toHaveBeenCalledWith(
      'start_timeout',
      'native recorder did not become ready within 20000ms',
    )
    expect(harness.forceRestartRecorder).toHaveBeenCalledOnce()
    expect(harness.deleteRecoveryRecording).toHaveBeenCalledWith(session.taskId)
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

  it('启动期取消不会因非终态错误提前删除仍可能写入的恢复资产', async () => {
    const session = createSession('canceled.m4a')
    setNativeRecordingSession(session)
    recordingState.startManualNative()
    recordingState.reset()

    expect(harness.stopRecording).toHaveBeenCalledOnce()
    expect(harness.stopRecording).toHaveBeenCalledWith(session.outputPath)
    harness.listeners.error?.({ code: 'device_failed', terminal: false })

    expect(peekNativeRecordingSession()).toEqual(session)
    expect(harness.deleteRecoveryRecording).not.toHaveBeenCalled()

    await Promise.resolve(harness.listeners.stopped?.({
      path: session.outputPath,
      duration: 0,
    }))

    expect(peekNativeRecordingSession()).toBeNull()
    expect(harness.deleteRecoveryRecording).toHaveBeenCalledWith(session.taskId)
    expect(recordingState.snapshot.phase).toBe('idle')
  })

  it.each(['terminal error', 'helper exit'] as const)('启动期取消在 %s 后清理 discard 状态', async (failure) => {
    const session = createSession(`canceled-${failure}.m4a`)
    setNativeRecordingSession(session)
    recordingState.startManualNative()
    recordingState.reset()

    if (failure === 'terminal error') {
      harness.listeners.error?.({
        code: 'not_recording',
        path: session.outputPath,
        terminal: true,
      })
    }
    else {
      harness.listeners.exited?.({ code: null, signal: 'SIGKILL' })
    }

    expect(harness.deleteRecoveryRecording).toHaveBeenCalledWith(session.taskId)
    expect(recordingState.snapshot.phase).toBe('idle')

    const nextSession = createSession('next-recording.m4a')
    setNativeRecordingSession(nextSession)
    recordingState.startManualNative()
    harness.listeners.recording?.({ path: nextSession.outputPath })
    recordingState.stop()
    await Promise.resolve(harness.listeners.stopped?.({
      path: nextSession.outputPath,
      duration: 1,
    }))

    expect(harness.deleteRecoveryRecording).toHaveBeenCalledOnce()
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

  it('handoff timeout 会结算业务会话并保留 recovery 资产', () => {
    const session = createSession('handoff-timeout.m4a')
    setNativeRecordingSession(session)
    recordingState.startManualNative()
    harness.listeners.recording?.({ path: session.outputPath })
    recordingState.stop()

    harness.listeners.error?.({
      code: 'handoff_timeout',
      detail: 'recovery assets were preserved',
      path: session.outputPath,
      terminal: true,
    })

    expect(peekNativeRecordingSession()).toBeNull()
    expect(recordingState.snapshot.phase).toBe('idle')
    expect(harness.deleteRecoveryRecording).not.toHaveBeenCalled()
  })

  it.each(['error', 'exit'] as const)('已消费 session 后迟到的 helper %s 不产生第二终态', async (event) => {
    const session = createSession(`settled-${event}.m4a`)
    setNativeRecordingSession(session)
    recordingState.startManualNative()
    harness.listeners.recording?.({ path: session.outputPath })
    recordingState.stop()

    const stopped = harness.listeners.stopped?.({
      path: session.outputPath,
      duration: 1,
    })

    if (event === 'error') {
      harness.listeners.error?.({
        code: 'helper_exited',
        path: session.outputPath,
        terminal: true,
      })
    }
    else {
      harness.listeners.exited?.({ code: 1, signal: null })
    }

    expect(recordingState.snapshot.phase).toBe('stopped')
    await Promise.resolve(stopped)
    expect(recordingState.snapshot.phase).toBe('idle')
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

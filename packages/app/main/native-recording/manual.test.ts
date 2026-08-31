import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  startRecording: vi.fn(() => true),
  updateRecording: vi.fn(),
  ensureRecordingStorageAvailable: vi.fn(() => Promise.resolve(true)),
  setManualRecordingPrefs: vi.fn(),
  setNativeRecordingSession: vi.fn(),
  initNativeRecordingPipeline: vi.fn(),
}))

vi.mock('@main/audio-recorder', () => ({
  startRecording: harness.startRecording,
  updateRecording: harness.updateRecording,
}))

vi.mock('@main/permissions', () => ({
  getPermissionStatus: vi.fn(() => 'granted'),
  getSystemAudioPermissionDetail: vi.fn(() => ({ status: 'granted' })),
  requestAudioCaptureIfNeverAsked: vi.fn(),
  requestPermission: vi.fn(() => Promise.resolve('granted')),
}))

vi.mock('@main/recording-recovery', () => ({
  createRecordingRecoverySession: vi.fn(() => ({
    taskId: 'manual-task',
    outputPath: '/tmp/manual-task.m4a',
  })),
}))

vi.mock('@main/recording-storage', () => ({
  ensureRecordingStorageAvailable: harness.ensureRecordingStorageAvailable,
}))

vi.mock('@main/utils/macos-version', () => ({
  isMacOSAtLeast: vi.fn(() => true),
}))

vi.mock('@main/utils/self-pids', () => ({
  getSelfProcessPids: vi.fn(() => [99]),
}))

vi.mock('.', () => ({
  failNativeRecordingStart: vi.fn(),
  initNativeRecordingPipeline: harness.initNativeRecordingPipeline,
}))

vi.mock('./session', () => ({
  hasNativeRecordingSession: vi.fn(() => false),
  setNativeRecordingSession: harness.setNativeRecordingSession,
}))

vi.mock('../recording-state', () => ({
  recordingState: {
    canStart: true,
    snapshot: { phase: 'idle' },
    startManualNative: vi.fn(() => ({ phase: 'starting' })),
    nativeSource: null,
  },
}))

describe('手动系统音频录音启动', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    harness.startRecording.mockClear().mockReturnValue(true)
    harness.updateRecording.mockClear()
    harness.ensureRecordingStorageAvailable.mockClear().mockResolvedValue(true)
    harness.setManualRecordingPrefs.mockClear()
    harness.setNativeRecordingSession.mockClear()
    harness.initNativeRecordingPipeline.mockClear()
  })

  it('默认只录麦克风，处理策略由 recorder 公共边界统一补齐', async () => {
    const { startManualRecording } = await import('./manual')

    await startManualRecording()

    expect(harness.startRecording).toHaveBeenCalledWith(
      '/tmp/manual-task.m4a',
      expect.objectContaining({
        engine: 'tap',
        tapEnabled: false,
        pids: [],
        mic: true,
      }),
    )
  })

  it('系统音频开启且 PID 为空时传递空数组，处理策略由 recorder 公共边界统一补齐', async () => {
    const { setManualRecordingPrefs, startManualRecording } = await import('./manual')
    setManualRecordingPrefs({ micEnabled: true, mixSystemAudio: true, pids: [] })

    await startManualRecording()

    expect(harness.startRecording).toHaveBeenCalledWith(
      '/tmp/manual-task.m4a',
      expect.objectContaining({
        engine: 'tap',
        tapEnabled: true,
        pids: [],
        mic: true,
      }),
    )
  })

  it('系统音频指定 PID 时只传递所选进程', async () => {
    const { setManualRecordingPrefs, startManualRecording } = await import('./manual')
    setManualRecordingPrefs({ micEnabled: true, mixSystemAudio: true, pids: [42, 84] })

    await startManualRecording()

    expect(harness.startRecording).toHaveBeenCalledWith(
      '/tmp/manual-task.m4a',
      expect.objectContaining({
        engine: 'tap',
        tapEnabled: true,
        pids: [42, 84],
        mic: true,
      }),
    )
  })
})

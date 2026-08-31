import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  onChange: null as ((processes: AudioProcess[]) => void) | null,
  snapshot: [] as AudioProcess[],
  startAudioMonitor: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('./audio-monitor-bridge', () => ({
  getAudioProcessSnapshot: () => harness.snapshot,
  onAudioProcessChange: (listener: (processes: AudioProcess[]) => void) => {
    harness.onChange = listener
    return harness.unsubscribe
  },
  startAudioMonitor: harness.startAudioMonitor,
}))

vi.mock('@main/utils/self-pids', () => ({
  getSelfProcessPids: () => [],
}))

vi.mock('./meeting-apps', () => ({
  isIgnoredApp: () => false,
  loadIgnoreOverrides: vi.fn(),
  matchApp: () => ({ id: 'lark', displayName: '飞书会议', bundleIds: ['com.electron.lark'] }),
}))

describe('会议检测运行时开关', () => {
  beforeEach(() => {
    vi.resetModules()
    harness.onChange = null
    harness.snapshot = [{
      pid: 42,
      name: 'Feishu',
      bundleId: 'com.electron.lark',
      executablePath: '/Applications/Feishu.app/Contents/MacOS/Feishu',
      isRunningInput: true,
      isRunningOutput: true,
    }]
    harness.startAudioMonitor.mockClear()
    harness.unsubscribe.mockClear()
  })

  it('重新开启时立即消费共享 monitor 现有快照，关闭时结算当前会议', async () => {
    const detector = await import('./meeting-detector')
    const listener = vi.fn()
    detector.onMeetingEvent(listener)

    detector.startMeetingDetector()
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'meeting-confirmed',
      session: expect.objectContaining({ pid: 42 }),
    }))

    detector.stopMeetingDetector()
    expect(harness.unsubscribe).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'meeting-ended',
      session: expect.objectContaining({ pid: 42 }),
    }))

    listener.mockClear()
    detector.startMeetingDetector()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'meeting-confirmed',
      session: expect.objectContaining({ pid: 42 }),
    }))
  })
})

type AudioProcess = {
  pid: number
  name: string
  bundleId: string
  executablePath: string
  isRunningInput: boolean
  isRunningOutput: boolean
}

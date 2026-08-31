import type { AudioLabSettings } from '@shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  active: null as AudioLabSettings | null,
  canStart: true,
  forceRestartRecorder: vi.fn<() => Promise<void>>(),
  persistAudioLabSettings: vi.fn(),
  startMeetingDetector: vi.fn(),
  stopMeetingDetector: vi.fn(),
}))

vi.mock('@main/audio-recorder', () => ({
  forceRestartRecorder: harness.forceRestartRecorder,
}))

vi.mock('@main/meeting-detection/meeting-detector', () => ({
  startMeetingDetector: harness.startMeetingDetector,
  stopMeetingDetector: harness.stopMeetingDetector,
}))

vi.mock('@main/recording-state', () => ({
  recordingState: {
    get canStart() {
      return harness.canStart
    },
  },
}))

vi.mock('./settings', () => ({
  buildAudioLabSettingsUpdate: (patch: Partial<AudioLabSettings>) => ({ ...harness.active!, ...patch }),
  getAudioLabSettings: () => ({ ...harness.active! }),
  persistAudioLabSettings: harness.persistAudioLabSettings,
  setActiveAudioLabSettings: (settings: AudioLabSettings) => {
    harness.active = { ...settings }
  },
}))

describe('audio lab settings controller', () => {
  beforeEach(() => {
    harness.active = createSettings()
    harness.canStart = true
    harness.forceRestartRecorder.mockReset()
    harness.forceRestartRecorder.mockResolvedValue()
    harness.persistAudioLabSettings.mockReset()
    harness.startMeetingDetector.mockReset()
    harness.stopMeetingDetector.mockReset()
  })

  it('声道切换先供下一代 helper 读取，换代成功后才持久化并关闭会议检测', async () => {
    harness.forceRestartRecorder.mockImplementation(async () => {
      expect(harness.active?.outputChannels).toBe(1)
      expect(harness.persistAudioLabSettings).not.toHaveBeenCalled()
    })

    const { updateAudioLabSettings } = await import('./controller')
    const result = await updateAudioLabSettings({
      outputChannels: 1,
      meetingDetectionEnabled: false,
    })

    expect(harness.forceRestartRecorder).toHaveBeenCalledOnce()
    expect(harness.stopMeetingDetector).toHaveBeenCalledOnce()
    expect(harness.startMeetingDetector).not.toHaveBeenCalled()
    expect(harness.persistAudioLabSettings).toHaveBeenCalledWith(result)
    expect(result).toMatchObject({ outputChannels: 1, meetingDetectionEnabled: false })
  })

  it('录制或收尾期间拒绝修改，不重启 helper、不写设置', async () => {
    harness.canStart = false
    const previous = { ...harness.active! }
    const { updateAudioLabSettings } = await import('./controller')

    await expect(updateAudioLabSettings({ outputChannels: 1 })).rejects.toThrow(
      'audio lab settings cannot change while recording is active or finalizing',
    )
    expect(harness.active).toEqual(previous)
    expect(harness.forceRestartRecorder).not.toHaveBeenCalled()
    expect(harness.persistAudioLabSettings).not.toHaveBeenCalled()
  })
})

function createSettings(): AudioLabSettings {
  return {
    outputChannels: 2,
    echoCancellation: 'auto',
    delayMode: 'auto',
    fixedDelayMs: 120,
    noiseSuppression: 'off',
    gainControl: 'off',
    highPass: true,
    meetingDetectionEnabled: true,
  }
}

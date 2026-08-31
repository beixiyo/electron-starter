/** 持久化并校验音频实验场设置；不负责 helper 或会议检测等运行时副作用 */

import type { AudioLabSettings, AudioLabSettingsPatch } from '@shared'
import { createStore } from '@main/store'

export const DEFAULT_AUDIO_LAB_SETTINGS: AudioLabSettings = {
  outputChannels: 2,
  echoCancellation: 'auto',
  delayMode: 'auto',
  fixedDelayMs: 120,
  noiseSuppression: 'off',
  gainControl: 'off',
  highPass: true,
  meetingDetectionEnabled: true,
}

const AUDIO_LAB_SETTING_KEYS = [
  'outputChannels',
  'echoCancellation',
  'delayMode',
  'fixedDelayMs',
  'noiseSuppression',
  'gainControl',
  'highPass',
  'meetingDetectionEnabled',
] as const satisfies readonly (keyof AudioLabSettings)[]

const AUDIO_LAB_SETTING_KEY_SET: ReadonlySet<string> = new Set(AUDIO_LAB_SETTING_KEYS)

const store = createStore<AudioLabSettings>('audio-lab-settings.json', DEFAULT_AUDIO_LAB_SETTINGS)
let activeSettings = normalizeStoredSettings(store.read())

/** 读取当前实际用于下一场录音的设置快照。 */
export function getAudioLabSettings(): AudioLabSettings {
  return { ...activeSettings }
}

/** 校验局部更新并生成完整的新设置；未知字段和非法值均明确拒绝。 */
export function buildAudioLabSettingsUpdate(patch: AudioLabSettingsPatch): AudioLabSettings {
  assertSettingsPatch(patch)
  return { ...activeSettings, ...patch }
}

/** 更新进程内生效设置；由 controller 在运行时副作用前调用。 */
export function setActiveAudioLabSettings(settings: AudioLabSettings): void {
  activeSettings = { ...settings }
}

/** 运行时副作用成功后持久化完整设置。 */
export function persistAudioLabSettings(settings: AudioLabSettings): void {
  store.write(settings)
}

/** helper 与恢复工具共用同一输出声道参数，避免正常录音和恢复产物声道漂移。 */
export function getAudioLabOutputArgs(): string[] {
  return activeSettings.outputChannels === 1
    ? ['--mono-output']
    : []
}

function normalizeStoredSettings(value: AudioLabSettings): AudioLabSettings {
  const normalized = { ...DEFAULT_AUDIO_LAB_SETTINGS }

  for (const key of AUDIO_LAB_SETTING_KEYS) {
    const candidate = value[key]
    if (isValidSettingValue(key, candidate)) {
      Object.assign(normalized, { [key]: candidate })
    }
  }

  return normalized
}

function assertSettingsPatch(value: unknown): asserts value is AudioLabSettingsPatch {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('audio lab settings patch must be an object')

  const patch = value as Record<string, unknown>
  const unknownKeys = Object.keys(patch).filter(key => !AUDIO_LAB_SETTING_KEY_SET.has(key))
  if (unknownKeys.length > 0)
    throw new Error(`unknown audio lab setting(s): ${unknownKeys.join(', ')}`)

  for (const [key, candidate] of Object.entries(patch)) {
    if (!isValidSettingValue(key as AudioLabSettingKey, candidate))
      throw new Error(`invalid audio lab setting: ${key}`)
  }
}

function isValidSettingValue(key: AudioLabSettingKey, value: unknown): boolean {
  switch (key) {
    case 'outputChannels':
      return value === 1 || value === 2
    case 'echoCancellation':
      return value === 'auto' || value === 'off'
    case 'delayMode':
      return value === 'auto' || value === 'fixed' || value === 'hybrid'
    case 'fixedDelayMs':
      return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 500
    case 'noiseSuppression':
      return ['off', 'low', 'moderate', 'high', 'very-high'].includes(String(value))
    case 'gainControl':
      return ['off', 'agc1-adaptive-digital', 'agc1-fixed', 'agc2'].includes(String(value))
    case 'highPass':
    case 'meetingDetectionEnabled':
      return typeof value === 'boolean'
  }
}

type AudioLabSettingKey = typeof AUDIO_LAB_SETTING_KEYS[number]

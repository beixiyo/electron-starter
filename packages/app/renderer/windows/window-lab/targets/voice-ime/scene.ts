/** 语音输入目标的中性场景预设；只包含可见状态，不连接真实输入链路。 */

import { VOICE_IME_SIZE } from '@shared'
import type { WindowLabPreview, WindowLabScene, WindowLabSize } from '../../types'
import type { WindowLabPreset } from '../types'

export const VOICE_IME_PRESETS: readonly WindowLabPreset[] = [
  { id: 'listening', label: 'Listening', description: 'Active listening capsule' },
  { id: 'countdown', label: 'Listening with countdown', description: 'Listening capsule with remaining time' },
  { id: 'transcribing', label: 'Transcribing', description: 'Processing capsule after input ends' },
  { id: 'prompt', label: 'Prompt', description: 'Compact prompt before input starts' },
  { id: 'canceled', label: 'Canceled', description: 'Undo window with no live session' },
  { id: 'failure', label: 'Failure', description: 'Retryable failure with optional detail' },
  { id: 'result', label: 'Result', description: 'Scrollable text result' },
]

export const DEFAULT_VOICE_IME_PREVIEW: WindowLabPreview = {
  target: 'voice-ime',
  theme: 'light',
  scene: { kind: 'recording', state: 'listening', remainingSeconds: null },
}

const PRESET_SCENES: Record<string, WindowLabScene> = {
  listening: { kind: 'recording', state: 'listening', remainingSeconds: null },
  countdown: { kind: 'recording', state: 'listening', remainingSeconds: 9 },
  transcribing: { kind: 'recording', state: 'transcribing', remainingSeconds: null },
  prompt: { kind: 'prompt' },
  canceled: { kind: 'canceled' },
  failure: {
    kind: 'failure',
    message: 'Unable to complete input',
    detail: 'The preview uses a static failure state.',
  },
  result: {
    kind: 'result',
    text: 'Find the architecture notes and list the open questions for the next review.',
    sourceHost: 'Editor',
  },
}

export function getVoiceImePresetId(preview: WindowLabPreview): string {
  return VOICE_IME_PRESETS.find((preset) => {
    return JSON.stringify(PRESET_SCENES[preset.id]) === JSON.stringify(preview.scene)
  })?.id ?? 'custom'
}

export function applyVoiceImePreset(preview: WindowLabPreview, presetId: string): WindowLabPreview {
  const scene = PRESET_SCENES[presetId]
  return scene
    ? { ...preview, scene }
    : preview
}

/** 生产浮层尺寸固定、可见期间不 resize，预览 frame 也一样：形变全在壳里 */
export function getVoiceImeInitialSize(_preview: WindowLabPreview): WindowLabSize {
  return { width: VOICE_IME_SIZE.width, height: VOICE_IME_SIZE.height }
}

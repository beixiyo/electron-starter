/** Window Lab 的 target 注册表。 */

import type { WindowLabPreview } from '../types'
import type { WindowLabTargetAdapter } from './types'
import { voiceImeTarget } from './voice-ime/voiceImeTarget'

export const WINDOW_LAB_TARGETS: Record<'voice-ime', WindowLabTargetAdapter> = {
  'voice-ime': voiceImeTarget,
}

export function getWindowLabTarget(preview: WindowLabPreview): WindowLabTargetAdapter {
  return WINDOW_LAB_TARGETS[preview.target]
}

export * from './types'
export * from './voice-ime/scene'

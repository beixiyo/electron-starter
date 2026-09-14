/** Window Lab URL 与 iframe 消息的边界校验。 */

import { isWindowLabPreview as isContractWindowLabPreview } from '@ipc/services/window-lab/contract'
import type { WindowLabPreview, WindowLabPreviewMessage, WindowLabSizeMessage } from './types'

export const DEFAULT_WINDOW_LAB_PREVIEW: WindowLabPreview = {
  target: 'voice-ime',
  theme: 'light',
  scene: { kind: 'recording', state: 'listening', remainingSeconds: null },
}

export const isWindowLabPreview = isContractWindowLabPreview

export function isWindowLabPreviewMessage(value: unknown): value is WindowLabPreviewMessage {
  return isRecord(value)
    && value.type === 'window-lab:preview'
    && isWindowLabPreview(value.preview)
}

export function isWindowLabSizeMessage(value: unknown): value is WindowLabSizeMessage {
  return isRecord(value)
    && value.type === 'window-lab:size'
    && value.target === 'voice-ime'
    && isFiniteDimension(value.width)
    && isFiniteDimension(value.height)
}

export function serializeWindowLabPreview(preview: WindowLabPreview): string {
  const params = new URLSearchParams()
  params.set('preview', JSON.stringify(preview))
  return params.toString()
}

export function parseWindowLabPreview(search: string): WindowLabPreview {
  try {
    const encoded = new URLSearchParams(search).get('preview')
    if (!encoded) return DEFAULT_WINDOW_LAB_PREVIEW
    const parsed: unknown = JSON.parse(encoded)
    return isWindowLabPreview(parsed)
      ? parsed
      : DEFAULT_WINDOW_LAB_PREVIEW
  }
  catch {
    return DEFAULT_WINDOW_LAB_PREVIEW
  }
}

function isFiniteDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 2000
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

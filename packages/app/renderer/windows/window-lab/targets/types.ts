/** Window Lab target adapter 的最小渲染契约。 */

import type { WindowLabPreview, WindowLabSize } from '../types'

export type WindowLabTargetAdapter = {
  id: 'voice-ime'
  label: string
  defaultPreview: WindowLabPreview
  presets: readonly WindowLabPreset[]
  Controls: React.ComponentType<WindowLabTargetControlsProps>
  Frame: React.ComponentType<WindowLabTargetFrameProps>
  getPresetId: (preview: WindowLabPreview) => string
  applyPreset: (preview: WindowLabPreview, presetId: string) => WindowLabPreview
  getInitialSize: (preview: WindowLabPreview) => WindowLabSize
}

export type WindowLabTargetControlsProps = {
  preview: WindowLabPreview
  onChange: (preview: WindowLabPreview) => void
}

export type WindowLabTargetFrameProps = {
  preview: WindowLabPreview
}

export type WindowLabPreset = {
  id: string
  label: string
  description: string
}

export type WindowLabPreviewFrameProps = WindowLabTargetFrameProps

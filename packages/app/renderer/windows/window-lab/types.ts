/** Window Lab 的渲染端数据与可选 Electron 桥类型。 */

import type { IpcClient } from '@ipc/core/contract'
import type {
  WindowLabContract,
  WindowLabPreview as ContractWindowLabPreview,
  WindowLabScene as ContractWindowLabScene,
} from '@ipc/services/window-lab/contract'
import type { WindowBounds } from '@shared'

export type WindowLabPreview = ContractWindowLabPreview
export type WindowLabScene = ContractWindowLabScene
export type WindowLabTheme = WindowLabPreview['theme']

export type WindowLabSize = {
  width: number
  height: number
}

export type WindowLabBounds = WindowBounds
export type WindowLabApi = IpcClient<WindowLabContract>

export type WindowLabPreviewMessage = {
  type: 'window-lab:preview'
  preview: WindowLabPreview
}

export type WindowLabSizeMessage = WindowLabSize & {
  type: 'window-lab:size'
  target: 'voice-ime'
}

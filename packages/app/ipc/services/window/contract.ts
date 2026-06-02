import type { IpcContract } from '@ipc/core'
import type { WindowBounds, WindowConfig, WindowMetadata, WindowType } from '@shared'

export type WindowContract = IpcContract<{
  create: (type: WindowType, configOverride?: Partial<WindowConfig>) => { success: boolean, windowId?: number, error?: string }
  show: (type: WindowType) => { success: boolean }
  hide: (type: WindowType) => { success: boolean }
  toggle: (type: WindowType) => { success: boolean, visible: boolean }
  destroy: (type: WindowType) => { success: boolean }
  isVisible: (type: WindowType) => { visible: boolean }
  exists: (type: WindowType) => { exists: boolean }
  getMetadata: (type: WindowType) => { metadata: WindowMetadata | undefined }
  getAllTypes: () => { types: WindowType[] }
  release: (type: WindowType | undefined, result?: unknown) => { success: boolean }
  isHolding: (type: WindowType | undefined) => { isHolding: boolean }
  getState: (type: WindowType | undefined) => { state: unknown }
  resizeTo: (type: WindowType, width: number, height: number, animate?: boolean) => { success: boolean }
  setBounds: (type: WindowType, bounds: Partial<WindowBounds>, animate?: boolean) => { success: boolean }
  getBounds: (type: WindowType) => { bounds: WindowBounds | null }
}>

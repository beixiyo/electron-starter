import type { IpcContract } from '@ipc/core'
import type { ScreenshotBounds, ScreenshotInitPayload, ScreenshotOkPayload } from '@shared'

export type ScreenshotContract = IpcContract<{
  startCapture: (options?: { hideWindows?: string[] }) => { success: boolean }
  endCapture: () => { success: boolean }
  confirmCapture: (displayId: number, rect: ScreenshotBounds) => void
  saveCapture: (displayId: number, rect: ScreenshotBounds) => void
  cancelCapture: () => void
}, {
  init: ScreenshotInitPayload
  ok: ScreenshotOkPayload
  save: ScreenshotOkPayload
  cancel: undefined
}>

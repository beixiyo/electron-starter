import type { ScreenshotBounds } from '@shared'
import type { ScreenshotContract } from './contract'
import { createIpcService } from '@ipc/core'
import { endCapture, startCapture } from '@main/screenshot'

export const screenshotService = createIpcService<ScreenshotContract>('screenshot', {
  async startCapture(_e) {
    await startCapture()
    return { success: true }
  },

  async endCapture(_e) {
    endCapture()
    return { success: true }
  },

  async confirmCapture(_e, displayId: number, rect: ScreenshotBounds) {
    const { handleConfirmCapture } = await import('@main/screenshot')
    return handleConfirmCapture(displayId, rect)
  },

  async saveCapture(_e, displayId: number, rect: ScreenshotBounds) {
    const { handleSaveCapture } = await import('@main/screenshot')
    return handleSaveCapture(displayId, rect)
  },

  async cancelCapture(_e) {
    const { handleCancelCapture } = await import('@main/screenshot')
    return handleCancelCapture()
  },
})

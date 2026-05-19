import { endCapture, startCapture } from '@main/screenshot'

export const screenshotHandlers = {
  async startCapture() {
    await startCapture()
    return { success: true }
  },

  async endCapture() {
    endCapture()
    return { success: true }
  },
}

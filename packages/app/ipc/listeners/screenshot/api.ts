import type { ScreenshotBounds, ScreenshotInitPayload, ScreenshotOkPayload } from '@shared'
import { screenshotServiceApi } from '@ipc/services/screenshot/api'
import { SCREENSHOT_CHANNEL } from '@shared'
import { ipcRenderer } from 'electron'

export const screenshotApi = {
  startCapture() {
    return screenshotServiceApi.startCapture()
  },

  endCapture() {
    return screenshotServiceApi.endCapture()
  },

  confirmCapture(displayId: number, rect: ScreenshotBounds) {
    return ipcRenderer.invoke('screenshot:confirmCapture', displayId, rect)
  },

  saveCapture(displayId: number, rect: ScreenshotBounds) {
    return ipcRenderer.invoke('screenshot:saveCapture', displayId, rect)
  },

  cancelCapture() {
    return ipcRenderer.invoke('screenshot:cancelCapture')
  },

  onInit(callback: (payload: ScreenshotInitPayload) => void) {
    const handler = (_: unknown, payload: ScreenshotInitPayload) => {
      callback(payload)
    }
    ipcRenderer.on(SCREENSHOT_CHANNEL.INIT, handler)
    return () => {
      ipcRenderer.removeListener(SCREENSHOT_CHANNEL.INIT, handler)
    }
  },

  onOk(callback: (payload: ScreenshotOkPayload) => void) {
    const handler = (_: unknown, payload: ScreenshotOkPayload) => {
      callback(payload)
    }
    ipcRenderer.on(SCREENSHOT_CHANNEL.OK, handler)
    return () => {
      ipcRenderer.removeListener(SCREENSHOT_CHANNEL.OK, handler)
    }
  },

  onSave(callback: (payload: ScreenshotOkPayload) => void) {
    const handler = (_: unknown, payload: ScreenshotOkPayload) => {
      callback(payload)
    }
    ipcRenderer.on(SCREENSHOT_CHANNEL.SAVE, handler)
    return () => {
      ipcRenderer.removeListener(SCREENSHOT_CHANNEL.SAVE, handler)
    }
  },

  onCancel(callback: () => void) {
    const handler = () => {
      callback()
    }
    ipcRenderer.on(SCREENSHOT_CHANNEL.CANCEL, handler)
    return () => {
      ipcRenderer.removeListener(SCREENSHOT_CHANNEL.CANCEL, handler)
    }
  },
}

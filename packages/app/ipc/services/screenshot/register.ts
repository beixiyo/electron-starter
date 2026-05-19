import { registerIpcMain } from '@ipc/core'
import { screenshotHandlers } from './handlers'

export function registerScreenshotHandlers(): void {
  registerIpcMain(screenshotHandlers, { namespace: 'screenshot' })
}

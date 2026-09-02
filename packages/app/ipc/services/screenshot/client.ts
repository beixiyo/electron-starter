import type { ScreenshotContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const screenshotClient = createServiceClient<ScreenshotContract>('screenshot', [
  'startCapture',
  'confirmCapture',
  'saveCapture',
  'cancelCapture',
  'requestInit',
])

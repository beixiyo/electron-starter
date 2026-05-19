import type { screenshotHandlers } from './handlers'
import { createIpcClient } from '@ipc/core'

type ScreenshotHandlers = typeof screenshotHandlers

export const screenshotServiceApi = createIpcClient<ScreenshotHandlers>({
  namespace: 'screenshot',
  methods: [
    'startCapture',
    'endCapture',
  ],
})

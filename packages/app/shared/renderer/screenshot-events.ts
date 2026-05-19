export type ScreenshotBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type ScreenshotInitPayload = {
  base64: string
  displayId: number
  scaleFactor: number
}

export type ScreenshotOkPayload = {
  base64: string
  bounds: ScreenshotBounds
}

export const SCREENSHOT_CHANNEL = {
  INIT: 'screenshot:init',
  OK: 'screenshot:ok',
  SAVE: 'screenshot:save',
  CANCEL: 'screenshot:cancel',
} as const

export type ScreenshotChannel = typeof SCREENSHOT_CHANNEL[keyof typeof SCREENSHOT_CHANNEL]

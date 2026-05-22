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

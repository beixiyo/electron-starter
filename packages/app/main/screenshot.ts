import type { ScreenshotBounds, ScreenshotOkPayload } from '@shared'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { SCREENSHOT_CHANNEL, WindowType } from '@shared'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
} from 'electron'
import { windowManager } from './window-manager'

type CaptureStore = {
  displayId: number
  scaleFactor: number
  imageBuffer: Buffer
}

let overlayWindows: BrowserWindow[] = []
const captures: Map<number, CaptureStore> = new Map()

export function initScreenshot(): void {
  ipcMain.handle('screenshot:confirmCapture', async (_e, displayId: number, rect: ScreenshotBounds) => {
    const capture = captures.get(displayId)
    if (!capture)
      return

    const cropped = await cropImage(capture, rect)
    if (cropped) {
      clipboard.writeImage(nativeImage.createFromBuffer(cropped))
      notifyMainWindow(SCREENSHOT_CHANNEL.OK, {
        base64: cropped.toString('base64'),
        bounds: rect,
      } satisfies ScreenshotOkPayload)
    }

    closeAllOverlays()
  })

  ipcMain.handle('screenshot:saveCapture', async (_e, displayId: number, rect: ScreenshotBounds) => {
    const capture = captures.get(displayId)
    if (!capture)
      return

    const cropped = await cropImage(capture, rect)
    if (!cropped) {
      closeAllOverlays()
      return
    }

    closeAllOverlays()

    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `screenshot-${Date.now()}.png`,
      filters: [{ name: 'Images', extensions: ['png'] }],
    })

    if (!canceled && filePath) {
      await writeFile(filePath, cropped)
    }

    notifyMainWindow(SCREENSHOT_CHANNEL.SAVE, {
      base64: cropped.toString('base64'),
      bounds: rect,
    } satisfies ScreenshotOkPayload)
  })

  ipcMain.handle('screenshot:cancelCapture', () => {
    closeAllOverlays()
    notifyMainWindow(SCREENSHOT_CHANNEL.CANCEL, null)
  })
}

export async function startCapture(): Promise<void> {
  closeAllOverlays()
  captures.clear()

  const displays = screen.getAllDisplays()

  const captureResults = await captureAllDisplays(displays)

  for (const result of captureResults) {
    captures.set(result.displayId, {
      displayId: result.displayId,
      scaleFactor: result.scaleFactor,
      imageBuffer: result.pngBuffer,
    })

    const win = createOverlayWindow(result.bounds)
    overlayWindows.push(win)

    const base64 = result.pngBuffer.toString('base64')

    win.once('ready-to-show', () => {
      win.show()
      win.focus()
      win.webContents.send(SCREENSHOT_CHANNEL.INIT, {
        base64,
        displayId: result.displayId,
        scaleFactor: result.scaleFactor,
      })
    })
  }
}

export function endCapture(): void {
  closeAllOverlays()
}

export function registerScreenshotShortcut(accelerator: string): void {
  globalShortcut.register(accelerator, () => {
    startCapture()
  })
}

function createOverlayWindow(bounds: Electron.Rectangle): BrowserWindow {
  const windowTypes: Record<string, string | undefined> = {
    darwin: 'panel',
    linux: undefined,
    win32: 'toolbar',
  }

  const preloadPath = is.dev
    ? resolve(__dirname, '../preload/index.cjs')
    : join(app.getAppPath(), 'out', 'preload', 'index.cjs')

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    type: windowTypes[process.platform] as string,
    frame: false,
    show: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreen: false,
    fullscreenable: false,
    hasShadow: false,
    titleBarStyle: 'hidden',
    enableLargerThanScreen: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  })

  if (process.platform === 'darwin') {
    win.setWindowButtonVisibility(false)
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    })
  }

  const htmlPath = 'windows/screenshot/index.html'
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(new URL(htmlPath, process.env.ELECTRON_RENDERER_URL).toString())
  }
  else {
    win.loadFile(join(app.getAppPath(), 'out', 'renderer', htmlPath))
  }

  return win
}

async function captureAllDisplays(displays: Electron.Display[]) {
  const { Monitor } = await import('node-screenshots')

  const results = await Promise.all(
    displays.map(async (display) => {
      const centerX = display.bounds.x + display.bounds.width / 2
      const centerY = display.bounds.y + display.bounds.height / 2

      const point = process.platform === 'win32'
        ? screen.screenToDipPoint({ x: centerX, y: centerY })
        : { x: centerX, y: centerY }

      const monitor = Monitor.fromPoint(point.x, point.y)
      if (!monitor) {
        throw new Error(`No monitor found at point (${point.x}, ${point.y})`)
      }

      const image = await monitor.captureImage()
      const pngBuffer = Buffer.from(await image.toPng())

      return {
        displayId: display.id,
        scaleFactor: display.scaleFactor,
        bounds: display.bounds,
        pngBuffer,
      }
    }),
  )

  return results
}

async function cropImage(capture: CaptureStore, rect: ScreenshotBounds): Promise<Buffer | null> {
  try {
    const { Monitor } = await import('node-screenshots')

    const monitors = Monitor.all()
    const monitor = monitors.find((m) => {
      const cx = Math.round(m.x() + m.width() / 2)
      const cy = Math.round(m.y() + m.height() / 2)
      const point = process.platform === 'win32'
        ? screen.screenToDipPoint({ x: cx, y: cy })
        : { x: cx, y: cy }
      const display = screen.getDisplayNearestPoint(point)
      return display.id === capture.displayId
    })

    if (!monitor)
      return null

    const image = await monitor.captureImage()
    const sf = capture.scaleFactor
    const cropped = await image.crop(
      Math.round(rect.x * sf),
      Math.round(rect.y * sf),
      Math.round(rect.width * sf),
      Math.round(rect.height * sf),
    )

    return Buffer.from(await cropped.toPng())
  }
  catch (err) {
    console.error('Screenshot crop failed:', err)
    return null
  }
}

function closeAllOverlays(): void {
  for (const win of overlayWindows) {
    if (!win.isDestroyed()) {
      win.destroy()
    }
  }
  overlayWindows = []
  captures.clear()
}

function notifyMainWindow(channel: string, data: unknown): void {
  const win = windowManager.get(WindowType.MAIN)
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data)
  }
}

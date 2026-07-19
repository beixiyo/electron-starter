import type {
  ScreenshotBounds,
  ScreenshotCancelPayload,
  ScreenshotFallbackTarget,
  ScreenshotOkPayload,
  ScreenshotStartOptions,
} from '@shared'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { WindowType } from '@shared'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  nativeImage,
  screen,
  webContents,
} from 'electron'
import { windowManager } from './window-manager'

type CaptureStore = {
  displayId: number
  scaleFactor: number
  imageBuffer: Buffer
}

/**
 * 截图会话（申请制）：同一时刻仅一个活跃会话
 *
 * - 渲染端发起：记录发起方 webContents id，完成/取消事件只定向发回该 webContents
 * - 全局快捷键发起：无渲染端申请方，按触发时的活跃功能裁决投递窗口与兜底消费方角色
 */
type CaptureSession = {
  /** 主进程生成的会话 id，事件 payload 携带，消费方校验 */
  captureId: string
  /** 发起方 webContents id；全局快捷键发起时为 null */
  ownerWebContentsId: number | null
  /** 快捷键会话的投递目标窗口（owner 为 null 时使用） */
  targetWindowType: WindowType | null
  /** 快捷键会话的兜底消费方角色，随完成事件下发 */
  fallback?: ScreenshotFallbackTarget
  /** 调试标识，仅用于日志，不参与路由 */
  requester?: string
}

let overlayWindows: BrowserWindow[] = []
const dimmedWindows: BrowserWindow[] = []
const captures: Map<number, CaptureStore> = new Map()

/** 当前活跃截图会话，新申请作废旧会话 */
let currentSession: CaptureSession | null = null

/**
 * 获取 screenshotService 发射器（延迟导入避免循环依赖）
 */
async function getScreenshotService() {
  const { screenshotService } = await import('@ipc/services/screenshot/service')
  return screenshotService
}

export async function handleConfirmCapture(displayId: number, rect: ScreenshotBounds): Promise<void> {
  const result = await cropCaptureForSession(displayId, rect)
  if (!result)
    return

  clipboard.writeImage(nativeImage.createFromBuffer(result.cropped))
  await emitCaptureResult(result.session, result.cropped, rect)
  releaseSession(result.session)
}

export async function handleSaveCapture(displayId: number, rect: ScreenshotBounds): Promise<void> {
  const result = await cropCaptureForSession(displayId, rect)
  if (!result)
    return

  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: `screenshot-${Date.now()}.png`,
    filters: [{ name: 'Images', extensions: ['png'] }],
  })

  if (!canceled && filePath) {
    await writeFile(filePath, result.cropped)
  }

  /** 保存到文件不向渲染端投递图片，发 cancel 让发起方清理本地持有的会话 id */
  await cancelSession(result.session)
}

export async function handleCancelCapture(): Promise<void> {
  closeAllOverlays()
  await cancelCurrentSession()
}

/**
 * 确认/保存的共享前奏：快照会话、裁剪选区、关闭覆盖层
 *
 * 快照当前会话：await 期间可能有新会话顶替，结果必须归属发起时的会话；
 * 裁剪失败视作取消（定向通知发起方清理本地会话状态），返回 null
 */
async function cropCaptureForSession(
  displayId: number,
  rect: ScreenshotBounds,
): Promise<{ session: CaptureSession, cropped: Buffer } | null> {
  const session = currentSession
  const capture = captures.get(displayId)
  if (!capture || !session)
    return null

  const cropped = await cropImage(capture, rect)
  closeAllOverlays()

  if (!cropped) {
    await cancelSession(session)
    return null
  }

  return { session, cropped }
}

/**
 * 渲染端申请截图会话
 *
 * @param options 截图选项（hideWindows / requester 调试标识）
 * @param owner 发起方 webContents，完成/取消事件只定向发回它
 * @returns 主进程生成的会话 id
 */
export async function startCapture(
  options?: ScreenshotStartOptions,
  owner?: Electron.WebContents,
): Promise<string> {
  return beginCaptureSession({
    captureId: randomUUID(),
    ownerWebContentsId: owner?.id ?? null,
    targetWindowType: null,
    requester: options?.requester,
  }, options)
}

/**
 * 全局快捷键（Cmd+Shift+A）发起截图：无渲染端申请方，
 * 投递给主窗并携带 `main` 兜底角色，由声明了该角色的消费者接收
 */
export async function startCaptureFromShortcut(): Promise<string> {
  return beginCaptureSession({
    captureId: randomUUID(),
    ownerWebContentsId: null,
    targetWindowType: WindowType.MAIN,
    fallback: 'main',
    requester: 'global-shortcut',
  })
}

/** 建立新会话（作废旧会话并定向通知旧 owner），随后唤起选区覆盖层 */
async function beginCaptureSession(
  session: CaptureSession,
  options?: ScreenshotStartOptions,
): Promise<string> {
  closeAllOverlays()
  await cancelCurrentSession()

  currentSession = session

  if (options?.hideWindows?.length) {
    for (const type of options.hideWindows) {
      const win = windowManager.get(type)
      if (win && !win.isDestroyed() && win.isVisible()) {
        win.setOpacity(0)
        dimmedWindows.push(win)
      }
    }
  }

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

    win.once('ready-to-show', async () => {
      win.show()
      win.focus()
      /** base64 发送点按需派生，对应截图已被兜底清理时跳过 */
      const capture = captures.get(result.displayId)
      if (!capture)
        return

      const service = await getScreenshotService()
      service.emit('init', {
        base64: capture.imageBuffer.toString('base64'),
        displayId: result.displayId,
        scaleFactor: result.scaleFactor,
      }, win)
    })

    /**
     * 兜底（E4）：overlay 异常消失（渲染端崩溃等）时无人走 closeAllOverlays，
     * 全屏 PNG Buffer 会驻留到下次截图。closeAllOverlays 主动销毁前已把窗口
     * 移出 overlayWindows，此处 indexOf 命中即为异常关闭
     */
    win.once('closed', () => {
      const index = overlayWindows.indexOf(win)
      if (index === -1)
        return

      overlayWindows.splice(index, 1)
      captures.delete(result.displayId)
      console.warn(`[screenshot] overlay window closed outside normal teardown (displayId=${result.displayId})`)

      if (overlayWindows.length === 0 && currentSession) {
        closeAllOverlays()
        void cancelCurrentSession()
      }
    })

    /**
     * 渲染进程崩溃/被 kill 时窗口不会自动关闭（只留空白覆盖层拦截鼠标），
     * 'closed' 兜底不会触发；主动 destroy 桥接到上面的 closed handler 统一清理
     */
    win.webContents.once('render-process-gone', (_event, details) => {
      console.warn(`[screenshot] overlay renderer gone, destroying window (displayId=${result.displayId}, reason=${details.reason})`)
      if (!win.isDestroyed())
        win.destroy()
    })
  }

  return session.captureId
}

/** 解析会话事件的投递目标窗口：owner webContents 优先，快捷键会话回落到目标窗口 */
function resolveSessionWindow(session: CaptureSession): BrowserWindow | null {
  if (session.ownerWebContentsId !== null) {
    const wc = webContents.fromId(session.ownerWebContentsId)
    if (!wc || wc.isDestroyed())
      return null
    const win = BrowserWindow.fromWebContents(wc)
    return win && !win.isDestroyed()
      ? win
      : null
  }

  if (session.targetWindowType) {
    const win = windowManager.get(session.targetWindowType)
    return win && !win.isDestroyed()
      ? win
      : null
  }

  return null
}

/** 完成事件：携带 captureId 定向发给会话发起方（彻底废除广播） */
async function emitCaptureResult(
  session: CaptureSession,
  cropped: Buffer,
  rect: ScreenshotBounds,
): Promise<void> {
  const target = resolveSessionWindow(session)
  if (!target) {
    console.warn(`[screenshot] capture result dropped: session owner gone (id=${session.captureId})`)
    return
  }

  const service = await getScreenshotService()
  service.emit('ok', {
    captureId: session.captureId,
    base64: cropped.toString('base64'),
    bounds: rect,
    fallback: session.fallback,
  } satisfies ScreenshotOkPayload, target)
}

/** 会话正常结束：仅当它仍是当前会话时清空（可能已被新会话顶替） */
function releaseSession(session: CaptureSession): void {
  if (currentSession === session)
    currentSession = null
}

/** 作废指定会话并向其发起方定向发 cancel 事件 */
async function cancelSession(session: CaptureSession): Promise<void> {
  releaseSession(session)
  const target = resolveSessionWindow(session)
  if (!target)
    return

  const service = await getScreenshotService()
  service.emit('cancel', {
    captureId: session.captureId,
  } satisfies ScreenshotCancelPayload, target)
}

/** 作废当前会话（用户取消 / 新申请顶替） */
async function cancelCurrentSession(): Promise<void> {
  if (currentSession)
    await cancelSession(currentSession)
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
  /** 先摘下再销毁：destroy 会同步触发 closed，摘下后兜底 handler 查不到窗口即知是主动销毁 */
  const wins = overlayWindows
  overlayWindows = []
  captures.clear()

  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.destroy()
    }
  }

  for (const win of dimmedWindows) {
    if (!win.isDestroyed()) {
      win.setOpacity(1)
    }
  }
  dimmedWindows.splice(0)
}

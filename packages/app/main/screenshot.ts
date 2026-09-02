import type {
  ScreenshotBounds,
  ScreenshotInitPayload,
  ScreenshotStartOptions,
} from '@shared'
import type { MainToRendererEmitter } from '@ipc/core'
import type { ScreenshotContract } from '@ipc/services/screenshot/contract'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { is } from '@electron-toolkit/utils'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  nativeImage,
  screen,
  webContents,
} from 'electron'
import { createMainDiagnosticLogger } from './logging'
import { ensureScreenPermissionOrExplain } from './permission-required'
import { getPermissionStatus, requestPermission } from './permissions'
import { captureAllDisplays, warmMacScreenshotCapture } from './screenshot-capture'
import { toIpcArrayBuffer } from './utils/ipc-buffer'
import { windowManager } from './window-manager'

type CaptureStore = {
  displayId: number
  scaleX: number
  scaleY: number
  imageBuffer: Buffer
}

type OverlayWindowEntry = {
  displayId: number
  window: BrowserWindow
  ready: Promise<void>
  loaded: boolean
}

type OverlayInitMeta = {
  captureId: string
  displayId: number
  scaleX: number
  scaleY: number
}

/**
 * 截图会话（申请制）：同一时刻仅一个活跃会话
 *
 * 记录发起方 webContents id，完成/取消事件只定向发回该 webContents
 */
type CaptureSession = {
  /** 主进程生成的会话 id，事件 payload 携带，消费方校验 */
  captureId: string
  /** 发起方 webContents id；owner 已销毁或缺失时为 null */
  ownerWebContentsId: number | null
  /** 会话被取消或顶替时终止仍在运行的原生捕获 */
  captureAbortController: AbortController
  /** 调试标识，仅用于日志，不参与路由 */
  requester?: string
}

const diagnosticLog = createMainDiagnosticLogger('screenshot')
const overlayPool: Map<number, OverlayWindowEntry> = new Map()
const activeOverlayDisplayIds: Set<number> = new Set()
const overlayInitPayloads: Map<number, OverlayInitMeta> = new Map()
const dimmedWindows: BrowserWindow[] = []
const captures: Map<number, CaptureStore> = new Map()
let isAppQuitting = false

app.once('before-quit', () => {
  isAppQuitting = true
})

/** 由 IPC service 注入，避免 screenshot.ts 与 service.ts 静态循环依赖 */
let emitter: MainToRendererEmitter<ScreenshotContract> | null = null

export function setScreenshotEmitter(next: MainToRendererEmitter<ScreenshotContract>): void {
  emitter = next
}

function emitTo<K extends string & keyof ScreenshotContract['rendererOn']>(
  event: K,
  payload: ScreenshotContract['rendererOn'][K],
  target: BrowserWindow | Electron.WebContents,
): void {
  if (!emitter) {
    diagnosticLog.warn('emitter.missing', 'screenshot event dropped: emitter not injected', { event })
    return
  }

  emitter.emit(event, payload, target)
}

function buildOverlayInitPayload(meta: OverlayInitMeta): ScreenshotInitPayload | null {
  const capture = captures.get(meta.displayId)
  if (!capture)
    return null

  return {
    captureId: meta.captureId,
    bytes: toIpcArrayBuffer(capture.imageBuffer),
    displayId: meta.displayId,
    scaleX: meta.scaleX,
    scaleY: meta.scaleY,
  }
}

/** overlay mount 后按自身 webContents 回拉当前会话底图 */
export function getOverlayInitPayload(webContentsId: number): ScreenshotInitPayload | null {
  const meta = overlayInitPayloads.get(webContentsId)
  return meta
    ? buildOverlayInitPayload(meta)
    : null
}

/** 当前活跃截图会话，新申请作废旧会话 */
let currentSession: CaptureSession | null = null

export async function handleConfirmCapture(displayId: number, rect: ScreenshotBounds): Promise<void> {
  const result = await cropCaptureForSession(displayId, rect)
  if (!result)
    return

  clipboard.writeImage(nativeImage.createFromBuffer(result.cropped))
  emitCaptureResult(result.session, result.cropped, rect)
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
  cancelSession(result.session)
}

export function handleCancelCapture(): void {
  closeAllOverlays()
  cancelCurrentSession()
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

  const cropped = cropImage(capture, rect)
  closeAllOverlays()

  if (!cropped) {
    cancelSession(session)
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
    captureAbortController: new AbortController(),
    requester: options?.requester,
  }, options)
}

/** 建立新会话（作废旧会话并定向通知旧 owner），随后唤起选区覆盖层 */
async function beginCaptureSession(
  session: CaptureSession,
  options?: ScreenshotStartOptions,
): Promise<string> {
  const startedAt = Date.now()
  closeAllOverlays()
  cancelCurrentSession()
  currentSession = session

  let hasPermission: boolean
  try {
    hasPermission = await ensureScreenCapturePermission()
  }
  catch (error) {
    releaseSession(session)
    throw error
  }

  if (!hasPermission) {
    diagnosticLog.warn('permission.blocked', 'screenshot capture blocked by screen permission', {
      captureId: session.captureId,
    })
    releaseSession(session)
    return ''
  }

  /** 权限检查期间可能已有新申请顶替；旧请求不得重新取得会话所有权 */
  if (currentSession !== session)
    return ''

  if (options?.hideWindows?.length) {
    for (const type of options.hideWindows) {
      const win = windowManager.get(type)
      if (win && !win.isDestroyed() && win.isVisible()) {
        win.setOpacity(0)
        dimmedWindows.push(win)
      }
    }
  }

  let captureResults: Awaited<ReturnType<typeof captureAllDisplays>>
  let overlayEntries: Map<number, OverlayWindowEntry>
  const displays = screen.getAllDisplays()
  const prewarmedDisplayCount = displays.filter(display => overlayPool.get(display.id)?.loaded).length

  try {
    /** 窗口未预热时让 renderer 加载与系统抓屏并行，避免两段冷启动串行相加 */
    [captureResults, overlayEntries] = await Promise.all([
      captureAllDisplays(displays, {
        signal: session.captureAbortController.signal,
      }),
      ensureOverlayWindows(displays),
    ])
  }
  catch (error) {
    if (session.captureAbortController.signal.aborted) {
      diagnosticLog.info('capture.cancelled', 'screenshot capture cancelled', {
        captureId: session.captureId,
        durationMs: Date.now() - startedAt,
      })
      return ''
    }

    diagnosticLog.error('capture.failed', 'screenshot capture failed', error, {
      captureId: session.captureId,
      durationMs: Date.now() - startedAt,
    })

    /** 新会话可能已在 await 期间顶替当前会话，不能清理它的窗口与状态 */
    if (currentSession === session) {
      closeAllOverlays()
      cancelSession(session)
    }
    return ''
  }

  /** 抓屏期间若有新申请顶替，本轮结果直接丢弃，绝不覆盖新会话 */
  if (currentSession !== session)
    return ''

  for (const result of captureResults) {
    const entry = overlayEntries.get(result.displayId)
    if (!entry) {
      diagnosticLog.error(
        'overlay.missing',
        'screenshot overlay missing after preparation',
        undefined,
        { captureId: session.captureId, displayId: result.displayId },
      )
      closeAllOverlays()
      cancelSession(session)
      return ''
    }

    captures.set(result.displayId, {
      displayId: result.displayId,
      scaleX: result.scaleX,
      scaleY: result.scaleY,
      imageBuffer: result.pngBuffer,
    })

    const initMeta: OverlayInitMeta = {
      captureId: session.captureId,
      displayId: result.displayId,
      scaleX: result.scaleX,
      scaleY: result.scaleY,
    }
    activeOverlayDisplayIds.add(result.displayId)
    overlayInitPayloads.set(entry.window.webContents.id, initMeta)

    const initPayload = buildOverlayInitPayload(initMeta)
    if (initPayload)
      emitTo('init', initPayload, entry.window)
  }

  /** 先把所有底图投递完再显示，避免多屏逐个闪出；光标所在屏获得键盘焦点 */
  for (const result of captureResults) {
    overlayEntries.get(result.displayId)?.window.showInactive()
  }

  const cursorDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
  const firstDisplayId = captureResults[0]?.displayId
  const focusEntry = overlayEntries.get(cursorDisplayId)
    ?? (firstDisplayId === undefined
      ? undefined
      : overlayEntries.get(firstDisplayId))
  focusEntry?.window.focus()

  diagnosticLog.info('capture.ready', 'screenshot overlays ready', {
    captureId: session.captureId,
    displayCount: captureResults.length,
    prewarmedDisplayCount,
    durationMs: Date.now() - startedAt,
  })

  return session.captureId
}

/** 解析截图申请方，owner 已销毁时不再投递结果 */
function resolveSessionWebContents(session: CaptureSession): Electron.WebContents | null {
  if (session.ownerWebContentsId !== null) {
    const wc = webContents.fromId(session.ownerWebContentsId)
    return wc && !wc.isDestroyed()
      ? wc
      : null
  }

  return null
}

/** 完成事件：携带 captureId 定向发给会话发起方（彻底废除广播） */
function emitCaptureResult(
  session: CaptureSession,
  cropped: Buffer,
  rect: ScreenshotBounds,
): void {
  const target = resolveSessionWebContents(session)
  if (!target) {
    console.warn(`[screenshot] capture result dropped: session owner gone (id=${session.captureId})`)
    return
  }

  emitTo('ok', {
    captureId: session.captureId,
    bytes: toIpcArrayBuffer(cropped),
    bounds: rect,
  }, target)
}

/** 会话正常结束：仅当它仍是当前会话时清空（可能已被新会话顶替） */
function releaseSession(session: CaptureSession): void {
  if (currentSession === session)
    currentSession = null
}

/** 作废指定会话并向其发起方定向发 cancel 事件 */
function cancelSession(session: CaptureSession): void {
  if (session.captureAbortController.signal.aborted)
    return

  session.captureAbortController.abort(new Error(`Screenshot session cancelled: ${session.captureId}`))
  releaseSession(session)
  const target = resolveSessionWebContents(session)
  if (!target)
    return

  emitTo('cancel', {
    captureId: session.captureId,
  }, target)
}

/** 作废当前会话（用户取消 / 新申请顶替） */
function cancelCurrentSession(): void {
  if (currentSession)
    cancelSession(currentSession)
}

/**
 * 启动空闲阶段预热截图 renderer；已有屏幕权限时同时预热 ScreenCaptureKit 服务。
 * 不主动申请权限，也不抓取或保存屏幕图像。
 */
export async function warmScreenshotOverlays(): Promise<void> {
  const startedAt = Date.now()
  try {
    const displays = screen.getAllDisplays()
    const nativeWarmup = process.platform === 'darwin' && getPermissionStatus('screen') === 'granted'
      ? warmMacScreenshotCapture().catch((error) => {
          diagnosticLog.warn('native.warm-failed', 'failed to warm native screenshot service', {
            error: error instanceof Error
              ? error.message
              : String(error),
          })
        })
      : Promise.resolve()

    await Promise.all([
      ensureOverlayWindows(displays),
      nativeWarmup,
    ])
    diagnosticLog.info('overlay.warmed', 'screenshot overlays warmed', {
      displayCount: displays.length,
      durationMs: Date.now() - startedAt,
    })
  }
  catch (error) {
    diagnosticLog.warn('overlay.warm-failed', 'failed to warm screenshot overlays', {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error
        ? error.message
        : String(error),
    })
  }
}

async function ensureScreenCapturePermission(): Promise<boolean> {
  if (process.platform !== 'darwin')
    return true

  if (getPermissionStatus('screen') === 'granted')
    return true

  const requested = await requestPermission('screen')
  if (requested === 'granted')
    return true

  ensureScreenPermissionOrExplain('screenshot-screen')
  return false
}

async function ensureOverlayWindows(
  displays: Electron.Display[],
): Promise<Map<number, OverlayWindowEntry>> {
  const displayIds = new Set(displays.map(display => display.id))

  /** 拓扑变化后回收已不存在的屏幕窗口；先移出池，closed handler 不会误判为崩溃 */
  for (const [displayId, entry] of overlayPool) {
    if (displayIds.has(displayId))
      continue

    discardOverlayWindow(entry)
  }

  const entries = displays.map((display) => {
    let entry = overlayPool.get(display.id)
    if (!entry || entry.window.isDestroyed()) {
      entry = createOverlayWindow(display)
      overlayPool.set(display.id, entry)
    }
    else if (!sameBounds(entry.window.getBounds(), display.bounds)) {
      entry.window.setBounds(display.bounds)
    }

    return entry
  })

  try {
    await Promise.all(entries.map(entry => entry.ready))
  }
  catch (error) {
    for (const entry of entries) {
      if (!entry.loaded)
        discardOverlayWindow(entry)
    }
    throw error
  }

  return new Map(entries.map(entry => [entry.displayId, entry]))
}

function createOverlayWindow(display: Electron.Display): OverlayWindowEntry {
  const { bounds } = display
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

  const entry: OverlayWindowEntry = {
    displayId: display.id,
    window: win,
    ready: Promise.resolve(),
    loaded: false,
  }

  const webContentsId = win.webContents.id
  const htmlPath = 'windows/screenshot/index.html'
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    entry.ready = win.loadURL(new URL(htmlPath, process.env.ELECTRON_RENDERER_URL).toString())
  }
  else {
    entry.ready = win.loadFile(join(app.getAppPath(), 'out', 'renderer', htmlPath))
  }

  entry.ready = entry.ready.then(() => {
    entry.loaded = true
  })

  /** 常驻 overlay 意外关闭时清理池与整屏缓存；活跃会话必须整体取消 */
  win.once('closed', () => {
    if (overlayPool.get(display.id) !== entry)
      return

    overlayPool.delete(display.id)
    overlayInitPayloads.delete(webContentsId)
    captures.delete(display.id)
    const wasActive = activeOverlayDisplayIds.delete(display.id)

    if (!isAppQuitting) {
      diagnosticLog.warn('overlay.closed-unexpectedly', 'screenshot overlay closed unexpectedly', {
        displayId: display.id,
        active: wasActive,
      })
    }

    if (!isAppQuitting && wasActive && currentSession) {
      closeAllOverlays()
      cancelCurrentSession()
    }
  })

  win.webContents.once('render-process-gone', (_event, details) => {
    diagnosticLog.warn('overlay.render-process-gone', 'screenshot overlay renderer gone', {
      displayId: display.id,
      reason: details.reason,
    })
    if (!win.isDestroyed())
      win.destroy()
  })

  return entry
}

function discardOverlayWindow(entry: OverlayWindowEntry): void {
  if (overlayPool.get(entry.displayId) === entry)
    overlayPool.delete(entry.displayId)

  activeOverlayDisplayIds.delete(entry.displayId)
  if (!entry.window.isDestroyed()) {
    overlayInitPayloads.delete(entry.window.webContents.id)
    entry.window.destroy()
  }
}

function sameBounds(a: Electron.Rectangle, b: Electron.Rectangle): boolean {
  return a.x === b.x
    && a.y === b.y
    && a.width === b.width
    && a.height === b.height
}

/**
 * 从会话缓存的整屏图裁剪选区
 *
 * 必须复用 capture.imageBuffer，不可重新抓屏：overlay 展示的是发起截图那一刻的冻结画面，
 * 用户是对着冻结画面框选的。若在确认时二次 captureImage()，取到的是「点确定那一刻」的屏幕，
 * 期间任何变化（通知弹出、光标闪烁、视频播放、动画）都会让出图与用户所见不一致，
 * 且白白多一次全屏抓取开销。
 *
 * 坐标系：rect 来自渲染层，是 DIP；crop 按原始像素计算，故分别乘由实际截图
 * 尺寸推导的 scaleX / scaleY。不能直接信 display.scaleFactor：捕获后端可能返回不同尺寸。
 */
function cropImage(capture: CaptureStore, rect: ScreenshotBounds): Buffer | null {
  try {
    const image = nativeImage.createFromBuffer(capture.imageBuffer)
    if (image.isEmpty())
      return null

    const cropped = image.crop({
      x: Math.round(rect.x * capture.scaleX),
      y: Math.round(rect.y * capture.scaleY),
      width: Math.round(rect.width * capture.scaleX),
      height: Math.round(rect.height * capture.scaleY),
    })

    if (cropped.isEmpty())
      return null

    return cropped.toPNG()
  }
  catch (err) {
    console.error('Screenshot crop failed:', err)
    return null
  }
}

function closeAllOverlays(): void {
  const activeDisplayIds = [...activeOverlayDisplayIds]
  activeOverlayDisplayIds.clear()

  for (const displayId of activeDisplayIds) {
    const entry = overlayPool.get(displayId)
    if (!entry || entry.window.isDestroyed())
      continue

    const meta = overlayInitPayloads.get(entry.window.webContents.id)
    if (meta)
      emitTo('reset', { captureId: meta.captureId }, entry.window)

    entry.window.hide()
  }

  captures.clear()
  overlayInitPayloads.clear()

  for (const win of dimmedWindows) {
    if (!win.isDestroyed()) {
      win.setOpacity(1)
    }
  }
  dimmedWindows.splice(0)
}

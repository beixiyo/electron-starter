import { is } from '@electron-toolkit/utils'
import type { MainToRendererEmitter } from '@ipc/core/contract'
import { createIpcService } from '@ipc/core/service'
import type { WindowLabContract, WindowLabOperationResult, WindowLabPreview } from '@ipc/services/window-lab/contract'
import { isWindowLabPreview, WINDOW_LAB_NAMESPACE } from '@ipc/services/window-lab/contract'
import type { WindowBounds, WindowConfig } from '@shared'
import { clampWindowBounds } from '@shared'
import { BrowserWindow, ipcMain, screen } from 'electron'
import { createBrowserWindow } from '../window-manager/window-factory'
import { waitForWindowReady } from '../window-readiness'
import { getWindowLabNativeTarget } from './targets'

const CONTROL_WINDOW_CONFIG: WindowConfig = {
  width: 1180,
  height: 760,
  minWidth: 960,
  minHeight: 640,
  position: 'center',
  title: 'Window Lab',
  frame: true,
  transparent: false,
  alwaysOnTop: false,
  skipTaskbar: false,
  resizable: true,
  movable: true,
  focusable: true,
  hasShadow: true,
  autoHideMenuBar: true,
  htmlPath: 'windows/window-lab/index.html',
  show: true,
}

const PREVIEW_METHODS = [
  'openControl',
  'openPreview',
  'closePreview',
  'getPreview',
  'resizeSelf',
  'getSelfBounds',
] as const

let activeController: WindowLabController | null = null

/**
 * 初始化开发态 Window Lab
 *
 * 控制窗和预览窗都是本模块私有的临时 BrowserWindow，不进入 WindowType 或窗口池
 * 重复初始化会先释放上一实例，便于开发重载和测试隔离
 */
export function initWindowLab(options: WindowLabOptions): WindowLabController {
  activeController?.dispose()

  let controlWindow: BrowserWindow | null = null
  let previewWindow: BrowserWindow | null = null
  let activePreview: WindowLabPreview | null = null
  let service: MainToRendererEmitter<WindowLabContract> | null = null
  let disposed = false
  let handlersRegistered = false
  const pendingPreviewPresentations = new WeakSet<BrowserWindow>()

  const openControl = (): WindowLabOperationResult => {
    if (disposed) return operationFailure('Window Lab has been disposed')
    if (!is.dev) return operationFailure('Window Lab is only available in development')

    if (isWindowAlive(controlWindow)) {
      controlWindow.show()
      controlWindow.focus()
      return { success: true, bounds: readBounds(controlWindow) ?? undefined }
    }

    const window = createBrowserWindow(CONTROL_WINDOW_CONFIG)
    controlWindow = window
    window.once('closed', () => {
      if (controlWindow !== window) return

      controlWindow = null
      activePreview = null
      destroyPreviewWindow()
    })

    return { success: true, bounds: readBounds(window) ?? undefined }
  }

  const openPreview = (preview: WindowLabPreview): WindowLabOperationResult => {
    if (disposed) return operationFailure('Window Lab has been disposed')
    if (!is.dev) return operationFailure('Window Lab is only available in development')
    if (!isWindowLabPreview(preview)) return operationFailure('Invalid Window Lab preview')
    if (!isWindowAlive(controlWindow)) return operationFailure('Window Lab control is not open')

    const target = getWindowLabNativeTarget(preview.target)
    if (activePreview && activePreview.target !== preview.target) {
      activePreview = null
      destroyPreviewWindow()
    }

    activePreview = preview
    const window = ensurePreviewWindow(target.windowConfig, target.title)
    requestPreviewPresentation(window)

    return { success: true, bounds: readBounds(window) ?? undefined }
  }

  const closePreview = (): WindowLabOperationResult => {
    if (disposed) return operationFailure('Window Lab has been disposed')

    activePreview = null
    destroyPreviewWindow()
    return { success: true }
  }

  const getPreview = (): WindowLabPreview | null => activePreview

  const resizeSelf = (
    event: unknown,
    rawWidth: number,
    rawHeight: number,
    animate = false,
  ): WindowLabOperationResult => {
    const window = getAuthorizedPreviewWindow(event)
    if (!window) return operationFailure('Only the native Window Lab preview can resize itself')
    if (!activePreview) return operationFailure('No active Window Lab preview')

    const current = readBounds(window)
    if (!current) return operationFailure('The native Window Lab preview is unavailable')

    const display = screen.getDisplayNearestPoint({
      x: current.x + current.width / 2,
      y: current.y + current.height / 2,
    })
    const width = normalizeDimension(rawWidth, display.workArea.width)
    const height = normalizeDimension(rawHeight, display.workArea.height)
    if (width === null || height === null) return operationFailure('Invalid preview dimensions')

    const target = getWindowLabNativeTarget(activePreview.target)
    const nextBounds = clampWindowBounds(
      target.resolveBounds({
        current,
        workArea: display.workArea,
        width,
        height,
      }),
      display.workArea,
      target.windowConfig.visibleContentInsets,
    )

    window.setBounds(nextBounds, animate)
    const bounds = readBounds(window)
    if (!bounds) return operationFailure('The native Window Lab preview is unavailable')

    emitBoundsChanged(bounds)
    return { success: true, bounds }
  }

  const getSelfBounds = (event: unknown): WindowLabOperationResult => {
    const window = getAuthorizedPreviewWindow(event)
    if (!window) return operationFailure('Only the native Window Lab preview can read its bounds')

    const bounds = readBounds(window)
    return bounds
      ? { success: true, bounds }
      : operationFailure('The native Window Lab preview is unavailable')
  }

  if (is.dev) {
    service = createIpcService<WindowLabContract>(WINDOW_LAB_NAMESPACE, {
      mainHandle: {
        openControl: (event) =>
          isTrustedMainSender(event)
            ? openControl()
            : unauthorizedOperation(),
        openPreview: (event, preview) =>
          isControlSender(event)
            ? openPreview(preview)
            : unauthorizedOperation(),
        closePreview: (event) =>
          isControlSender(event)
            ? closePreview()
            : unauthorizedOperation(),
        getPreview: (event) =>
          isControlSender(event) || isPreviewSender(event)
            ? getPreview()
            : null,
        resizeSelf,
        getSelfBounds,
      },
    })
    handlersRegistered = true
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true

    activePreview = null
    const preview = previewWindow
    const control = controlWindow
    previewWindow = null
    controlWindow = null

    if (preview && !preview.isDestroyed()) preview.destroy()
    if (control && !control.isDestroyed()) control.destroy()

    if (handlersRegistered) {
      for (const method of PREVIEW_METHODS) {
        ipcMain.removeHandler(`${WINDOW_LAB_NAMESPACE}:${method}`)
      }
      handlersRegistered = false
    }

    if (activeController?.dispose === dispose) activeController = null
  }

  const controller: WindowLabController = { openControl, dispose }
  activeController = controller
  return controller

  function ensurePreviewWindow(config: WindowConfig, title: string): BrowserWindow {
    if (isWindowAlive(previewWindow)) return previewWindow

    const window = createBrowserWindow({
      ...config,
      title,
      htmlPath: 'windows/window-lab/frame.html',
      show: false,
    })
    previewWindow = window

    window.webContents.on('did-finish-load', () => {
      requestPreviewPresentation(window)
    })
    window.on('move', emitCurrentBounds)
    window.on('resize', emitCurrentBounds)
    window.once('closed', () => {
      if (previewWindow !== window) return

      previewWindow = null
      activePreview = null
      emitBoundsChanged(null)
    })

    return window

    function emitCurrentBounds(): void {
      if (disposed || previewWindow !== window || !activePreview) return

      const bounds = readBounds(window)
      if (bounds) emitBoundsChanged(bounds)
    }
  }

  function requestPreviewPresentation(window: BrowserWindow): void {
    if (!activePreview || !isWindowAlive(window)) return
    if (pendingPreviewPresentations.has(window)) return
    pendingPreviewPresentations.add(window)

    void waitForWindowReady(window).then((ready) => {
      pendingPreviewPresentations.delete(window)
      if (!ready) {
        if (!disposed && previewWindow === window) {
          activePreview = null
          destroyPreviewWindow()
        }
        return
      }
      if (disposed || previewWindow !== window || !activePreview || !isWindowAlive(window)) return

      service?.emit('previewChanged', activePreview, window)
      window.showInactive()
    })
  }

  function destroyPreviewWindow(): void {
    const window = previewWindow
    previewWindow = null

    if (window && !window.isDestroyed()) window.destroy()
    emitBoundsChanged(null)
  }

  function emitBoundsChanged(bounds: WindowBounds | null): void {
    if (disposed) return

    const target = isWindowAlive(controlWindow)
      ? controlWindow
      : null
    if (target) service?.emit('boundsChanged', bounds, target)
  }

  function getAuthorizedPreviewWindow(event: unknown): BrowserWindow | null {
    const window = getWindowFromEvent(event)
    return window && window === previewWindow && isWindowAlive(window)
      ? window
      : null
  }

  function isControlSender(event: unknown): boolean {
    const senderWindow = getWindowFromEvent(event)
    return senderWindow !== null
      && senderWindow === controlWindow
      && isWindowAlive(senderWindow)
  }

  function isPreviewSender(event: unknown): boolean {
    return getAuthorizedPreviewWindow(event) !== null
  }

  function isTrustedMainSender(event: unknown): boolean {
    const mainWindow = resolveMainWindow(options)
    const senderWindow = getWindowFromEvent(event)
    return mainWindow !== null
      && senderWindow !== null
      && senderWindow === mainWindow
      && isWindowAlive(mainWindow)
  }
}

function resolveMainWindow(options: WindowLabOptions): BrowserWindow | null {
  try {
    const window = options.resolveMainWindow()
    return window && isWindowAlive(window)
      ? window
      : null
  }
  catch {
    return null
  }
}

function getWindowFromEvent(event: unknown): BrowserWindow | null {
  const sender = (event as Partial<Electron.IpcMainInvokeEvent> | undefined)?.sender
  if (!sender || typeof sender.isDestroyed !== 'function') return null

  try {
    if (sender.isDestroyed()) return null
    return BrowserWindow.fromWebContents(sender)
  }
  catch {
    return null
  }
}

function isWindowAlive(window: BrowserWindow | null): window is BrowserWindow {
  return window !== null && !window.isDestroyed()
}

function readBounds(window: BrowserWindow): WindowBounds | null {
  if (!isWindowAlive(window)) return null

  try {
    return window.getBounds()
  }
  catch {
    return null
  }
}

function normalizeDimension(value: number, maximum: number): number | null {
  if (!Number.isFinite(value) || value <= 0 || maximum <= 0) return null
  return Math.min(Math.round(value), maximum)
}

function operationFailure(error: string): WindowLabOperationResult {
  return { success: false, error }
}

function unauthorizedOperation(): WindowLabOperationResult {
  return operationFailure('Unauthorized Window Lab caller')
}

/** Window Lab 初始化所需的主窗口解析器。 */
export type WindowLabOptions = {
  /** 返回当前可信主窗口；解析失败时 IPC 请求将被拒绝。 */
  resolveMainWindow: () => BrowserWindow | null
}

/** Window Lab 生命周期控制面。dispose 可重复调用。 */
export type WindowLabController = {
  /** 由主进程直接调用时无需 sender；IPC 调用仍会校验主窗口 sender。 */
  openControl: () => WindowLabOperationResult
  /** 销毁控制窗、预览窗并移除开发态 IPC handler。 */
  dispose: () => void
}

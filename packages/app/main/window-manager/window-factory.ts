import type { WindowConfig, WindowPosition, WindowType } from '@shared'
import type { BrowserWindowConstructorOptions } from 'electron'
import { join, resolve } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { app, BrowserWindow, screen } from 'electron'
import { DEFAULT_WINDOW_SIZE, WINDOW_POSITION_MARGINS } from './window-position-constants'

export function createBrowserWindow(
  config: WindowConfig,
  parent?: BrowserWindow,
  windowType?: WindowType,
): BrowserWindow {
  const {
    position,
    htmlPath,
    initialUrl,
    width: rawWidth,
    height: rawHeight,
    ...browserWindowConfig
  } = config

  const { width, height } = clampWindowSize(rawWidth, rawHeight)
  const { x, y } = calculateWindowPosition(position, width, height)

  const browserWindowOptions: BrowserWindowConstructorOptions = {
    width,
    height,
    x,
    y,
    frame: browserWindowConfig.frame ?? true,
    transparent: browserWindowConfig.transparent ?? false,
    alwaysOnTop: browserWindowConfig.alwaysOnTop ?? false,
    skipTaskbar: browserWindowConfig.skipTaskbar ?? false,
    resizable: browserWindowConfig.resizable ?? true,
    movable: browserWindowConfig.movable ?? true,
    focusable: browserWindowConfig.focusable ?? true,
    hasShadow: browserWindowConfig.hasShadow ?? true,
    ...browserWindowConfig,
  }

  /** 如果是模态窗口，设置父窗口 */
  if (browserWindowOptions.modal && parent) {
    browserWindowOptions.parent = parent
  }

  /** 设置 webPreferences */
  browserWindowOptions.webPreferences = {
    preload: is.dev
      ? resolve(__dirname, '../preload/index.cjs')
      : join(app.getAppPath(), 'out', 'preload', 'index.cjs'),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: false, // 禁用沙箱模式，允许预加载脚本访问更多 Node.js API
    ...config?.webPreferences,
  }

  const window = new BrowserWindow(browserWindowOptions)

  /**
   * blur 时重新置顶，防止部分平台失焦后置顶失效
   * 配置了 setAlwaysOnTopOnShow 的窗口除外：其置顶由 windowManager 的
   * show/hide 动态管理，hide 触发的 blur 若在此重新置顶会与之互相抵消
   */
  if (browserWindowOptions.alwaysOnTop && !config.setAlwaysOnTopOnShow) {
    window.setAlwaysOnTop(true, 'floating')
    window.on('blur', () => {
      if (!window.isDestroyed()) {
        window.setAlwaysOnTop(true, 'floating')
      }
    })
  }

  window.webContents.on('did-finish-load', () => {
    window.webContents.insertCSS('html { overflow: hidden !important; }')
  })

  /** 移除窗口菜单（如果需要） */
  if (!config.frame) {
    window.setMenuBarVisibility(false)
  }

  /** 加载页面 */
  if (initialUrl) {
    window.loadURL(initialUrl)
  }
  else if (htmlPath) {
    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      const baseUrl = process.env.ELECTRON_RENDERER_URL
      const devUrlBase
        = htmlPath && htmlPath !== 'index.html'
          ? new URL(htmlPath, baseUrl).toString()
          : baseUrl
      const devUrl = new URL(devUrlBase)

      if (windowType)
        devUrl.searchParams.set('windowType', windowType)
      window.loadURL(devUrl.toString())
    }
    else {
      /** 文件协议加载 */
      const query = windowType
        ? { windowType }
        : undefined
      window.loadFile(join(app.getAppPath(), 'out', 'renderer', htmlPath), { query })

      /**
       * 自定义协议加载
       * 因为 file 协议不会被自动设置 cookie，所以添加自定义协议，并且后端设置
       *   1. `Access-Control-Allow-Origin` 必须返回 `$APP_PROTOCOL://app`（不能是 `*`，因为要带 Cookie）
       *   2. `Access-Control-Allow-Credentials: true`
       *   3. 预检请求要允许常用方法/头
       *   4. 登录接口的 `Set-Cookie` 正常写，`SameSite=Lax/Strict` 都会生效，因为在后端看来这是被允许的一方
       */
      // const targetPath = config.htmlPath ?? 'index.html'
      // window.loadURL(buildAppProtocolUrl(targetPath))
    }
  }
  else {
    window.loadURL('about:blank')
  }

  return window
}

function clampWindowSize(
  width = DEFAULT_WINDOW_SIZE.width,
  height = DEFAULT_WINDOW_SIZE.height,
): { width: number, height: number } {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

  const horizontalMargin = WINDOW_POSITION_MARGINS.standard * 2
  const verticalMargin = WINDOW_POSITION_MARGINS.standard * 2

  const maxWidth = screenWidth - horizontalMargin
  const maxHeight = screenHeight - verticalMargin

  const safeWidth = maxWidth > 0
    ? Math.min(width, maxWidth)
    : Math.min(width, screenWidth)

  const safeHeight = maxHeight > 0
    ? Math.min(height, maxHeight)
    : Math.min(height, screenHeight)

  return {
    width: safeWidth,
    height: safeHeight,
  }
}

function calculateWindowPosition(
  position: WindowPosition | undefined,
  width = DEFAULT_WINDOW_SIZE.width,
  height = DEFAULT_WINDOW_SIZE.height,
): { x: number, y: number } {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize
  const { x: screenX, y: screenY } = primaryDisplay.workArea

  if (typeof position === 'object' && 'x' in position && 'y' in position) {
    return { x: position.x, y: position.y }
  }

  switch (position) {
    case 'center':
      return {
        x: Math.floor(screenX + (screenWidth - width) / 2),
        y: Math.floor(screenY + (screenHeight - height) / 2),
      }

    case 'top-center':
      return {
        x: Math.floor(screenX + (screenWidth - width) / 2),
        y: Math.floor(screenY + WINDOW_POSITION_MARGINS.topCenter),
      }

    case 'bottom-center':
      return {
        x: Math.floor(screenX + (screenWidth - width) / 2),
        y: Math.floor(screenY + screenHeight - height - WINDOW_POSITION_MARGINS.bottomCenter),
      }

    case 'top-left':
      return {
        x: Math.floor(screenX + WINDOW_POSITION_MARGINS.standard),
        y: Math.floor(screenY + WINDOW_POSITION_MARGINS.standard),
      }

    case 'top-right':
      return {
        x: Math.floor(screenX + screenWidth - width - WINDOW_POSITION_MARGINS.standard),
        y: Math.floor(screenY + WINDOW_POSITION_MARGINS.standard),
      }

    case 'bottom-left':
      return {
        x: Math.floor(screenX + WINDOW_POSITION_MARGINS.standard),
        y: Math.floor(screenY + screenHeight - height - WINDOW_POSITION_MARGINS.standard),
      }

    case 'bottom-right':
      return {
        x: Math.floor(screenX + screenWidth - width - WINDOW_POSITION_MARGINS.standard),
        y: Math.floor(screenY + screenHeight - height - WINDOW_POSITION_MARGINS.standard),
      }

    default:
      /** 默认居中 */
      return {
        x: Math.floor(screenX + (screenWidth - width) / 2),
        y: Math.floor(screenY + (screenHeight - height) / 2),
      }
  }
}

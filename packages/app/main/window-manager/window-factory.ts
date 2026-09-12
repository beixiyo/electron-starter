import { is } from '@electron-toolkit/utils'
import type { WindowConfig, WindowInsets, WindowPosition, WindowType } from '@shared'
import { allowsFrameOutsideWorkArea, resolveAlwaysOnTopLevel, resolveVisibleContentInsets } from '@shared'
import type { BrowserWindowConstructorOptions } from 'electron'
import { app, BrowserWindow, screen } from 'electron'
import { join, resolve } from 'node:path'
import { attachWindowDiagnostics } from '../logging/window-diagnostics'
import { trackWindowReadiness } from '../window-readiness'
import { resolveTargetDisplay } from './display-target'
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
    useAppPreload = true,
    macFullscreenAuxiliary,
    alwaysOnTopLevel: _alwaysOnTopLevel,
    visibleContentInsets: _visibleContentInsets,
    targetDisplay,
    repositionOnShow: _repositionOnShow,
    ...browserWindowConfig
  } = config

  const alwaysOnTopLevel = resolveAlwaysOnTopLevel(config)
  /** 绝对位置（包括持久化恢复）以落点屏限制尺寸，不能被光标所在小屏缩小 */
  const display = typeof position === 'object'
    ? screen.getDisplayNearestPoint({
        x: position.x + (rawWidth ?? DEFAULT_WINDOW_SIZE.width) / 2,
        y: position.y + (rawHeight ?? DEFAULT_WINDOW_SIZE.height) / 2,
      })
    : resolveTargetDisplay(targetDisplay)
  const { width, height } = clampWindowSize(rawWidth, rawHeight, display)
  const { x, y } = calculateWindowPosition({
    position,
    width,
    height,
    visibleContentInsets: resolveVisibleContentInsets(config),
    display,
  })

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
    /**
     * 位置由预设决定、且声明了可见内容留白的窗口，必须同时解除系统对 frame 的收敛，
     * 否则那圈纯透明留白一到展示就被判成越界（判据见 {@link allowsFrameOutsideWorkArea}）
     *
     * macOS 上 AppKit 会对普通窗口执行 `constrainFrameRect:toScreen:`，只有开了本开关
     * Electron 才跳过它。实测（独立 Electron 实验进程，workArea 1710×1072、起点 y=40）：
     * 底部浮层构造后 y=1002（下沿越出 22px），关闭本开关时 `show()` / `showInactive()`
     * 后被夹到 y=980，可见内容离底从净空值变成一个完整 inset；贴顶的浮层同理被夹到
     * 工作区顶边，而且**事后补一次 `setBounds` 也救不回来**——顶边是硬约束，只有 x 能恢复
     * 开启本开关后，两个档位在构造 / 展示 / 再次 setBounds 之后都停在预设落点
     *
     * 其余窗口保持系统默认收敛：它们的窗口边就是可见边，越界没有任何理由
     */
    enableLargerThanScreen: browserWindowConfig.enableLargerThanScreen ?? allowsFrameOutsideWorkArea(config),
    ...browserWindowConfig,
  }

  if (macFullscreenAuxiliary && process.platform === 'darwin') {
    browserWindowOptions.type = 'panel'
  }

  /** 如果是模态窗口，设置父窗口 */
  if (browserWindowOptions.modal && parent) {
    browserWindowOptions.parent = parent
  }

  /** 设置 webPreferences */
  browserWindowOptions.webPreferences = {
    ...(useAppPreload
      ? {
        preload: is.dev
          ? resolve(__dirname, '../preload/index.cjs')
          : join(app.getAppPath(), 'out', 'preload', 'index.cjs'),
      }
      : {}),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: !useAppPreload,
    ...config?.webPreferences,
  }

  const window = new BrowserWindow(browserWindowOptions)
  trackWindowReadiness(window)
  attachWindowDiagnostics(window, windowType)
  applyMacFullscreenAuxiliary(window, macFullscreenAuxiliary)

  /**
   * blur 时重新置顶，防止部分平台失焦后置顶失效
   * 配置了 setAlwaysOnTopOnShow 的窗口除外：其置顶由 windowManager 的
   * show/hide 动态管理，hide 触发的 blur 若在此重新置顶会与之互相抵消
   */
  if (browserWindowOptions.alwaysOnTop && !config.setAlwaysOnTopOnShow) {
    window.setAlwaysOnTop(true, alwaysOnTopLevel)
    window.on('blur', () => {
      if (!window.isDestroyed()) {
        window.setAlwaysOnTop(true, alwaysOnTopLevel)
      }
    })
  }

  /**
   * 仅对加载本地 app 页面的窗口锁 html 滚动；OAUTH 一类加载三方远程页
   * （有 initialUrl、无 htmlPath）的窗口不能强制 overflow:hidden，
   * 否则超高的登录/同意页无法滚动、把用户卡住
   */
  if (htmlPath && !initialUrl) {
    const webContents = window.webContents
    webContents.on('did-finish-load', () => {
      if (!webContents.isDestroyed()) webContents.insertCSS('html { overflow: hidden !important; }').catch(() => {})
    })
  }

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
      const devUrlBase = htmlPath && htmlPath !== 'index.html'
        ? new URL(htmlPath, baseUrl).toString()
        : baseUrl
      const devUrl = new URL(devUrlBase)

      if (windowType) devUrl.searchParams.set('windowType', windowType)
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
       *
       * 接法：
       * ```ts
       * const targetPath = config.htmlPath ?? 'index.html'
       * window.loadURL(buildAppProtocolUrl(targetPath))
       * ```
       */
    }
  }
  else {
    window.loadURL('about:blank')
  }

  return window
}

function applyMacFullscreenAuxiliary(window: BrowserWindow, enabled?: boolean): void {
  if (!enabled || process.platform !== 'darwin') {
    return
  }

  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  })
  window.setFullScreenable(false)
}

function clampWindowSize(
  width = DEFAULT_WINDOW_SIZE.width,
  height = DEFAULT_WINDOW_SIZE.height,
  display: Electron.Display = screen.getPrimaryDisplay(),
): { width: number; height: number } {
  const { width: screenWidth, height: screenHeight } = display.workAreaSize

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

/**
 * 计算窗口预设位置
 *
 * 预设里的边距量的是**可见内容**距工作区边缘多远，而不是窗口边——透明浮层窗四周
 * 带一圈给投影用的留白，不扣掉它，可见内容就会比预设值各偏一个 inset
 * 所以声明了可见内容留白的窗口在这里把自己贴边那侧的留白让回去；
 * 留白为 0 的窗口行为与从前逐像素一致
 *
 * 扣完之后落点常常会让窗口 frame 越出工作区（贴边档只要 inset 大于预设边距就会），
 * 这是预期内的：越出去的只有纯透明留白。但系统默认会把这类 frame 收敛回可用区，
 * 所以声明了留白的窗口必须同时解除该收敛，见 {@link createBrowserWindow} 里
 * `enableLargerThanScreen` 的说明
 */
export function calculateWindowPosition(
  options: CalculateWindowPositionOptions = {},
): { x: number; y: number } {
  const {
    position,
    width = DEFAULT_WINDOW_SIZE.width,
    height = DEFAULT_WINDOW_SIZE.height,
    visibleContentInsets = {},
    display = screen.getPrimaryDisplay(),
  } = options

  const { width: screenWidth, height: screenHeight } = display.workAreaSize
  const { x: screenX, y: screenY } = display.workArea
  const {
    top: insetTop = 0,
    right: insetRight = 0,
    bottom: insetBottom = 0,
    left: insetLeft = 0,
  } = visibleContentInsets

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
        y: Math.floor(screenY + WINDOW_POSITION_MARGINS.topCenter - insetTop),
      }

    case 'bottom-center':
      return {
        x: Math.floor(screenX + (screenWidth - width) / 2),
        y: Math.floor(screenY + screenHeight - height - WINDOW_POSITION_MARGINS.bottomCenter + insetBottom),
      }

    case 'top-left':
      return {
        x: Math.floor(screenX + WINDOW_POSITION_MARGINS.standard - insetLeft),
        y: Math.floor(screenY + WINDOW_POSITION_MARGINS.standard - insetTop),
      }

    case 'top-right':
      return {
        x: Math.floor(screenX + screenWidth - width - WINDOW_POSITION_MARGINS.standard + insetRight),
        y: Math.floor(screenY + WINDOW_POSITION_MARGINS.standard - insetTop),
      }

    case 'bottom-left':
      return {
        x: Math.floor(screenX + WINDOW_POSITION_MARGINS.standard - insetLeft),
        y: Math.floor(screenY + screenHeight - height - WINDOW_POSITION_MARGINS.standard + insetBottom),
      }

    case 'bottom-right':
      return {
        x: Math.floor(screenX + screenWidth - width - WINDOW_POSITION_MARGINS.standard + insetRight),
        y: Math.floor(screenY + screenHeight - height - WINDOW_POSITION_MARGINS.standard + insetBottom),
      }

    default:
      /** 默认居中 */
      return {
        x: Math.floor(screenX + (screenWidth - width) / 2),
        y: Math.floor(screenY + (screenHeight - height) / 2),
      }
  }
}

/** {@link calculateWindowPosition} 参数 */
export type CalculateWindowPositionOptions = {
  position?: WindowPosition
  /** @default DEFAULT_WINDOW_SIZE.width */
  width?: number
  /** @default DEFAULT_WINDOW_SIZE.height */
  height?: number
  /**
   * 可见内容相对窗口四边的留白，由 `resolveVisibleContentInsets` 归一化后传入
   *
   * @default 四边皆 0
   */
  visibleContentInsets?: Partial<WindowInsets>
  /**
   * 预设位相对哪块屏计算
   *
   * @default 系统主屏
   */
  display?: Electron.Display
}

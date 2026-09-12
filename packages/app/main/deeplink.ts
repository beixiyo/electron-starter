/** 注册自定义协议，并将 OAuth 深链回调安全转发到主窗口 */
import type { OAuthCallbackParams } from '@shared'
import { resolve } from 'node:path'
import { sendOAuthCallback } from '@ipc/services/oauth/service'
import { APP_PROTOCOL, WindowType } from '@shared'
import { app, dialog } from 'electron'
import { ensureMainWindowReady } from './main-window-opener'
import { isMacOSAtLeast } from './utils/macos-version'
import { windowManager } from './window-manager'

let reopenMainWindow: () => void = () => {}
let startupReadyPromise: Promise<boolean> | null = null

/**
 * 自定义 URL Scheme / 深链（用于 Apple 登录等回调）
 *
 * @param options 启动平台门禁；未传入最低版本时不限制 macOS 版本
 * @default {}
 */
export function initDeeplink(
  whenReady: () => void,
  openMainWindow: () => void,
  options: DeeplinkOptions = {},
): void {
  reopenMainWindow = openMainWindow
  startupReadyPromise = null
  /** Windows/Linux 冷启动时协议 URL 位于首个实例的 argv，而非 second-instance */
  const initialDeepLink = process.platform === 'darwin'
    ? undefined
    : findDeepLink(process.argv)

  if (process.defaultApp && process.platform === 'darwin') {
    /** macOS 开发态不能可靠注册协议，打包后由 Info.plist 声明 */
    console.info('[deeplink] protocol registration requires a packaged app on macOS')
  }
  else if (process.defaultApp) {
    /** Windows/Linux 开发模式（例如 electron-vite dev） */
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [resolve(process.argv[1])])
    }
  }
  else {
    /** 打包后的应用，Electron 会自己处理路径 */
    app.setAsDefaultProtocolClient(APP_PROTOCOL)
  }

  const gotTheLock = app.requestSingleInstanceLock()

  if (!gotTheLock) {
    app.quit()
  }
  else {
    app.on('second-instance', (_event, commandLine, _workingDirectory) => {
      /** 启动参数可能位于 URL 前后，不能假设深链始终是最后一项 */
      void handleDeepLinkUrl(findDeepLink(commandLine) ?? '')
    })

    /** 先完成平台门禁，再创建主窗口和初始化其余应用服务 */
    startupReadyPromise = app.whenReady().then(() => {
      const minimumMacOS = options.minimumMacOS
      if (minimumMacOS && !isMacOSSupported(minimumMacOS)) {
        showUnsupportedMacOS(minimumMacOS)
        return false
      }

      whenReady()
      return true
    })
    void startupReadyPromise.then((isReady) => {
      if (isReady && initialDeepLink)
        void handleDeepLinkUrl(initialDeepLink)
    })
  }

  /** macOS */
  app.on('open-url', (event, url) => {
    event.preventDefault()
    void handleDeepLinkUrl(url)
  })
}

/**
 * 统一处理深链 URL（当前用于 Apple 登录回调等）
 * - 记录最近一次深链 URL
 * - 复用（或创建）主窗口并聚焦
 */
async function handleDeepLinkUrl(url: string): Promise<void> {
  const callback = parseOAuthCallback(url)

  const isReady = await (startupReadyPromise ?? Promise.resolve(false))
  if (!isReady)
    return

  if (!windowManager.get(WindowType.MAIN))
    reopenMainWindow()
  const mainWindow = await ensureMainWindowReady()

  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn('[deeplink] main window is unavailable')
    return
  }

  windowManager.show(WindowType.MAIN)

  if (!callback) {
    console.warn('[deeplink] invalid OAuth callback')
    return
  }

  sendOAuthCallback(mainWindow, callback)
  await navigateToLogin(mainWindow)
}

/** 从启动参数中提取协议 URL，不依赖固定下标 */
function findDeepLink(commandLine: readonly string[]): string | undefined {
  return commandLine.find(value => value.startsWith(`${APP_PROTOCOL}://`))
}

/** 仅接受 oauth/complete 路径及 OAuth callback 白名单字段 */
function parseOAuthCallback(value: string): OAuthCallbackParams | null {
  try {
    const url = new URL(value)
    if (url.protocol !== `${APP_PROTOCOL}:` || url.host !== 'oauth' || url.pathname !== '/complete')
      return null

    const provider = url.searchParams.get('provider')
    if (provider !== 'apple' && provider !== 'google')
      return null

    const code = readQueryParam(url, 'code')
    const error = readQueryParam(url, 'error')
    if (!code && !error)
      return null

    return {
      provider,
      code,
      state: readQueryParam(url, 'state'),
      username: readQueryParam(url, 'username'),
      error,
      error_description: readQueryParam(url, 'error_description'),
    }
  }
  catch {
    return null
  }
}

/** 将缺失和空白参数统一归一化为 undefined */
function readQueryParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)?.trim()
  return value || undefined
}

/**
 * 模板主窗口使用 Hash Router；先等待首次页面加载，再通过 hash 进入登录页
 * 回调先进入 pending；loadURL 重建 renderer 后由登录页重新注册并领取
 */
async function navigateToLogin(mainWindow: Electron.BrowserWindow): Promise<void> {

  if (mainWindow.isDestroyed())
    return

  const currentUrl = mainWindow.webContents.getURL()
  if (!currentUrl)
    return

  const loginUrl = new URL(currentUrl)
  if (loginUrl.hash === '#/login')
    return

  loginUrl.hash = '/login'
  await mainWindow.loadURL(loginUrl.toString())
}

/** 非 macOS 或未配置门槛时放行；版本判断只在 macOS 且配置了门槛时执行。 */
function isMacOSSupported(minimumMacOS: MacOSVersion): boolean {
  return process.platform !== 'darwin' || isMacOSAtLeast(minimumMacOS.major, minimumMacOS.minor)
}

function showUnsupportedMacOS(minimumMacOS: MacOSVersion): void {
  dialog.showErrorBox(
    'macOS Version Not Supported',
    `This app requires macOS ${minimumMacOS.major}.${minimumMacOS.minor} or later.\n\nYour version: macOS ${process.getSystemVersion()}`,
  )
  app.quit()
}

export interface DeeplinkOptions {
  /**
   * macOS 启动最低版本；未配置时不限制启动版本
   *
   * @default undefined
   */
  minimumMacOS?: MacOSVersion
}

/** 可配置的 macOS 版本号，不绑定具体原生能力或业务功能。 */
export interface MacOSVersion {
  major: number
  minor: number
}

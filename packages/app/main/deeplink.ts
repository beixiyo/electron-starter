/** 注册自定义协议，并将 OAuth 深链回调安全转发到主窗口 */
import type { OAuthCallbackParams } from '@shared'
import { resolve } from 'node:path'
import { sendOAuthCallback } from '@ipc/services/oauth/service'
import { APP_PROTOCOL, WindowType } from '@shared'
import { app } from 'electron'
import { windowManager } from './window-manager'

let reopenMainWindow: () => void = () => {}

/**
 * 自定义 URL Scheme / 深链（用于 Apple 登录等回调）
 */
export function initDeeplink(whenReady: () => void, openMainWindow: () => void): void {
  reopenMainWindow = openMainWindow
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

    /** 创建主窗口，加载应用程序的其他部分，等等... */
    app.whenReady().then(() => {
      whenReady()
      if (initialDeepLink)
        void handleDeepLinkUrl(initialDeepLink)
    })
  }

  // Mac
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

  await app.whenReady()
  let mainWindow = windowManager.get(WindowType.MAIN)
  if (!mainWindow || mainWindow.isDestroyed()) {
    reopenMainWindow()
    mainWindow = windowManager.get(WindowType.MAIN)
  }

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
  if (mainWindow.webContents.isLoadingMainFrame()) {
    await new Promise<void>((resolve) => {
      mainWindow.webContents.once('did-finish-load', () => resolve())
    })
  }

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

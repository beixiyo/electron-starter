import { resolve } from 'node:path'
import { APP_PROTOCOL, WindowType } from '@shared'
import { app } from 'electron'
import { windowManager } from './window-manager'

/**
 * 自定义 URL Scheme / 深链（用于 Apple 登录等回调）
 */
export function initDeeplink(whenReady: Function): void {
  if (process.defaultApp) {
    /** 开发模式（例如 electron-vite dev） */
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
      const mainWindow = windowManager.get(WindowType.MAIN)
      /** 用户正在尝试运行第二个实例，我们需要让焦点指向我们的窗口 */
      if (mainWindow) {
        if (mainWindow.isMinimized())
          mainWindow.restore()
        mainWindow.focus()
      }

      /** 命令行是一个字符串数组，其中最后一个元素是深度链接的URL。 */
      handleDeepLinkUrl(commandLine.pop() || '')
    })

    /** 创建主窗口，加载应用程序的其他部分，等等... */
    app.whenReady().then(() => {
      whenReady()
    })
  }

  // Mac
  app.on('open-url', (_event, url) => {
    handleDeepLinkUrl(url)
  })
}

/**
 * 统一处理深链 URL（当前用于 Apple 登录回调等）
 * - 记录最近一次深链 URL
 * - 复用（或创建）主窗口并聚焦
 */
function handleDeepLinkUrl(url: string): void {
  console.log('[deeplink] received url:', url)

  // @TODO: 后续可以在这里解析 code/state 等参数，并通过 IPC 下发给渲染进程
}

/** 统一主窗关闭隐藏与应用退出销毁，防止隐藏拦截阻断更新安装 */
import type { BrowserWindow } from 'electron'
import { app, autoUpdater, BrowserWindow as ElectronBrowserWindow } from 'electron'

/** 正常退出及更新安装均绕过 close 拦截，包含未登记到窗口管理器的窗口 */
export function initWindowQuitCleanup(): void {
  app.on('before-quit', destroyAllWindows)
  autoUpdater.on('before-quit-for-update', destroyAllWindows)
}

/** macOS 关闭主窗时保留 renderer 中的任务；其他平台保持关闭退出语义 */
export function attachMainWindowCloseBehavior(window: BrowserWindow): void {
  if (process.platform !== 'darwin')
    return

  window.on('close', (event) => {
    event.preventDefault()
    if (window.isFullScreen()) {
      /** 先退出原生全屏 Space，再隐藏，避免留下空白全屏桌面 */
      window.once('leave-full-screen', () => {
        if (!window.isDestroyed())
          window.hide()
      })
      window.setFullScreen(false)
    }
    else {
      window.hide()
    }
  })
}

/** destroy 不触发可取消的 close 事件，更新安装才能等到窗口列表清空 */
function destroyAllWindows(): void {
  for (const window of ElectronBrowserWindow.getAllWindows()) {
    if (!window.isDestroyed())
      window.destroy()
  }
}

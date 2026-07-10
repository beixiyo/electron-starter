import type { WindowType } from '@shared'
import type { BrowserWindow } from 'electron'
import { shouldPreloadLogicalWindow } from '@shared'
import { windowManager } from './window-manager'

export type WindowLoadTask = {
  type: WindowType
  /** Called after the window's renderer finishes loading */
  onLoaded?: (win: BrowserWindow) => void
}

/**
 * Creates windows one by one, waiting for each renderer to finish loading
 * before starting the next. Prevents the CPU/memory spike from initializing
 * multiple Chromium processes simultaneously at startup.
 *
 * @param tasks - Ordered list of windows to create
 * @param timeoutMs - Max wait per window before moving on (default 2000ms)
 */
export async function createWindowsSequentially(
  tasks: WindowLoadTask[],
  timeoutMs = 2000,
): Promise<void> {
  for (const task of tasks) {
    if (!shouldPreloadLogicalWindow(task.type)) {
      console.log(`[window-loader] skip preload type=${task.type}: not a dedicated logical window`)
      continue
    }

    /**
     * 已存在的窗口直接跳过（如 macOS 关闭主窗后 Dock activate 重入）：
     * 它们早已加载完成，did-finish-load 不会再触发，
     * 继续往下走只会白等 timeoutMs 并重复执行 onLoaded
     */
    if (windowManager.exists(task.type)) {
      console.log(`[window-loader] skip preload type=${task.type}: already exists`)
      continue
    }

    const startedAt = Date.now()
    const win = windowManager.create(task.type)
    if (!win)
      continue

    const webContents = win.webContents

    await new Promise<void>((resolve) => {
      let settled = false

      const done = (message: string): void => {
        if (settled)
          return

        settled = true
        clearTimeout(timer)
        win.off('closed', onClosed)
        if (!webContents.isDestroyed())
          webContents.removeListener('did-finish-load', onLoad)

        console.log(message)
        resolve()
      }

      const onLoad = (): void => {
        done(`[window-loader] loaded type=${task.type} duration=${Date.now() - startedAt}ms`)
      }
      const onClosed = (): void => {
        done(`[window-loader] stop waiting type=${task.type}: window closed`)
      }
      const timer = setTimeout(() => {
        /** 超时放行时移除监听器，避免在长寿命 webContents 上累积 */
        done(`[window-loader] preload timeout type=${task.type} timeout=${timeoutMs}ms`)
      }, timeoutMs)
      webContents.once('did-finish-load', onLoad)
      win.once('closed', onClosed)
    })

    if (!win.isDestroyed())
      task.onLoaded?.(win)
  }
}

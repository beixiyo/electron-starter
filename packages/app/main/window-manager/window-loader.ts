import type { WindowType } from '@shared'
import type { BrowserWindow } from 'electron'
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
    /**
     * 已存在的窗口直接跳过（如 macOS 关闭主窗后 Dock activate 重入）：
     * 它们早已加载完成，did-finish-load 不会再触发，
     * 继续往下走只会白等 timeoutMs 并重复执行 onLoaded
     */
    if (windowManager.exists(task.type))
      continue

    const win = windowManager.create(task.type)
    if (!win)
      continue

    await new Promise<void>((resolve) => {
      const onLoad = (): void => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        /** 超时放行时移除监听器，避免在长寿命 webContents 上累积 */
        win.webContents.removeListener('did-finish-load', onLoad)
        resolve()
      }, timeoutMs)
      win.webContents.once('did-finish-load', onLoad)
    })

    task.onLoaded?.(win)
  }
}

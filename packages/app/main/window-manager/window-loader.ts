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
    const win = windowManager.create(task.type)
    if (!win)
      continue

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      win.webContents.once('did-finish-load', () => {
        clearTimeout(timer)
        resolve()
      })
    })

    task.onLoaded?.(win)
  }
}

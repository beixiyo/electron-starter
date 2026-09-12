/** 为 IPC、深链和权限提示提供主窗口重建及加载就绪入口 */
import type { BrowserWindow } from 'electron'
import { WindowType } from '@shared'
import { windowManager } from './window-manager'
import { waitForWindowReady } from './window-readiness'

let opener: (() => BrowserWindow | null) | undefined

/** 注册由应用装配层负责的完整建窗流程 */
export function registerMainWindowOpener(open: () => BrowserWindow | null): void {
  opener = open
}

/** 打开并前置主窗口；未注册装配流程时返回 null */
export function requestMainWindow(): BrowserWindow | null {
  return opener?.() ?? null
}

/** 确保主窗口存在且完成首次加载；关闭、加载失败或超时返回 null */
export async function ensureMainWindowReady(options: MainWindowReadyOptions = {}): Promise<BrowserWindow | null> {
  const existing = windowManager.get(WindowType.MAIN)
  const win = existing && !existing.isDestroyed()
    ? existing
    : requestMainWindow()
  if (!win || win.isDestroyed())
    return null

  const ready = await waitForWindowReady(win, options)
  return ready && !win.isDestroyed()
    ? win
    : null
}

/** 主窗口首次加载等待选项 */
export interface MainWindowReadyOptions {
  /**
   * 最长等待时间，单位毫秒
   * @default 5000
   */
  timeoutMs?: number
}

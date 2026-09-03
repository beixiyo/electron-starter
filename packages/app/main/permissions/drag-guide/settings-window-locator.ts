/**
 * 定位「系统设置」窗口
 *
 * 走 `settings-window` helper 的 CGWindowListCopyWindowInfo，而不是 AXUIElement：
 * 读别的 App 的 AX 树要求**本进程已被授予辅助功能权限**，而这个引导恰恰用在
 * 用户还没授权的时候，AX 路线在此处必然拿不到窗口。窗口几何与所属进程则是免权限可读的
 */

import { createMainDiagnosticLogger } from '@main/logging'
import { getNativeBinaryPath } from '@main/native-bridge'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Rect } from './placement'
import { isSameRect } from './placement'

const execFileAsync = promisify(execFile)
const log = createMainDiagnosticLogger('permission.drag-guide')

const PROBE_TIMEOUT_MS = 2_000
const SAMPLE_INTERVAL_MS = 120

/** 单次探测：拿不到窗口返回 null */
export async function probeSettingsWindow(): Promise<SettingsWindowProbe | null> {
  try {
    const { stdout } = await execFileAsync(
      getNativeBinaryPath('settings-window'),
      [],
      { timeout: PROBE_TIMEOUT_MS },
    )
    const parsed = JSON.parse(stdout) as ProbeResult
    if (!parsed.found) return null

    return {
      bounds: {
        x: parsed.x,
        y: parsed.y,
        width: parsed.width,
        height: parsed.height,
      },
      sheetPresented: parsed.sheet,
    }
  }
  catch (error) {
    log.warn('probe.failed', 'settings-window helper probe failed', { error: String(error) })
    return null
  }
}

/**
 * 等系统设置窗口出现**并停止移动**再返回
 *
 * 冷启动、从 Dock 恢复的精灵动画、切换面板都会让窗口在若干帧内换位置
 * 直接用第一帧会把卡片贴到一个中间态坐标上，因此要求连续两次采样完全一致
 *
 * @param budgetMs 总等待预算，超时返回最后一次采到的矩形（可能为 null）
 */
export async function waitForStableSettingsWindow(budgetMs: number): Promise<Rect | null> {
  const deadline = Date.now() + budgetMs
  let previous: Rect | null = null

  while (Date.now() < deadline) {
    const current = (await probeSettingsWindow())?.bounds ?? null

    if (current && isSameRect(previous, current)) {
      return current
    }

    previous = current
    await sleep(SAMPLE_INTERVAL_MS)
  }

  log.info('probe.budget-exhausted', 'settings window did not stabilise in budget', {
    budgetMs,
    found: previous !== null,
  })
  return previous
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 一次探测的结果 */
export type SettingsWindowProbe = {
  /** 系统设置主窗口矩形（全局屏幕坐标） */
  bounds: Rect
  /**
   * 主窗口上是否挂着 sheet
   *
   * 拖入后系统要求管理员确认（输入密码 / Touch ID）时，那个确认框是系统设置自己
   * 挂在主窗口内的一个窗口。调用方据此让卡片让位，否则会盖住输入框
   */
  sheetPresented: boolean
}

type ProbeResult =
  | { found: false }
  | { found: true; x: number; y: number; width: number; height: number; sheet: boolean; owner: string | null }

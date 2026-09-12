/** 目标屏解析：把窗口该落在哪块屏的策略收敛到一处 */

import { isObj } from '@jl-org/tool'
import type { WindowBounds, WindowDisplayTarget, WindowInsets } from '@shared'
import { clampWindowBounds } from '@shared'
import type { Display } from 'electron'
import { BrowserWindow, screen } from 'electron'

/**
 * 窗口未指定目标屏时跟随光标所在屏
 *
 * Electron 没有直接表示当前焦点屏的 API，光标所在屏是可用的通用代理。
 */
export const DEFAULT_WINDOW_DISPLAY_TARGET: WindowDisplayTarget = 'cursor'

/**
 * 解析目标屏；目标屏不可用时回落到光标所在屏
 */
export function resolveTargetDisplay(
  target: WindowDisplayTarget = DEFAULT_WINDOW_DISPLAY_TARGET,
  context: ResolveTargetDisplayContext = {},
): Display {
  if (isObj(target)) {
    return screen.getAllDisplays().find((display) => display.id === target.displayId)
      ?? getCursorDisplay()
  }

  switch (target) {
    case 'primary':
      return screen.getPrimaryDisplay()

    case 'focused-window': {
      const focused = BrowserWindow.getFocusedWindow()
      if (focused && !focused.isDestroyed() && focused !== context.exclude) {
        return getDisplayOfWindow(focused)
      }
      return getCursorDisplay()
    }

    case 'cursor':
    default:
      return getCursorDisplay()
  }
}

/** 按窗口中心点解析窗口当前所在屏，避免边缘几像素导致跨屏误判 */
export function getDisplayOfWindow(window: BrowserWindow): Display {
  const bounds = window.getBounds()
  return screen.getDisplayNearestPoint({
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  })
}

/**
 * 跨屏移动时同时写入位置和完整 bounds，避免不同缩放比的屏幕间尺寸换算偏差
 */
export function moveWindowToBounds(window: BrowserWindow, bounds: WindowBounds): void {
  const { x, y, width, height } = bounds
  window.setPosition(x, y, false)
  window.setBounds({ x, y, width, height })
}

/**
 * 收敛窗口在目标屏的 bounds：透明留白可以探出虚拟桌面边缘，不能探进相邻屏
 *
 * 某侧留白与另一块屏相交时，该侧留白不再参与边界放宽；没有相邻屏时保留原有的
 * 可见内容口径。这样既处理重叠屏上的系统窗口收敛，也不改变虚拟桌面外的容忍行为
 */
export function clampWindowBoundsToDisplay(
  bounds: WindowBounds,
  display: Display,
  insets: Partial<WindowInsets> = {},
): WindowBounds {
  const { top = 0, right = 0, bottom = 0, left = 0 } = insets
  const area = display.bounds
  const others = screen.getAllDisplays().filter((other) => other.id !== display.id)

  let allowed: WindowInsets = { top, right, bottom, left }

  /**
   * 先按当前允许的留白算候选 bounds，再用候选 x / y 检查相邻屏。
   * 某侧已被挡住后只收紧不放宽，避免不同侧互相改变候选位置造成来回摆动
   */
  for (let pass = 0; pass < 4; pass += 1) {
    const candidate = clampWindowBounds(bounds, display.workArea, allowed)
    const next = { ...allowed }

    if (allowed.top > 0 && stripIntersectsOtherDisplay({
      x: candidate.x,
      y: area.y - allowed.top,
      width: candidate.width,
      height: allowed.top,
    }, others)) {
      next.top = 0
    }
    if (allowed.bottom > 0 && stripIntersectsOtherDisplay({
      x: candidate.x,
      y: area.y + area.height,
      width: candidate.width,
      height: allowed.bottom,
    }, others)) {
      next.bottom = 0
    }
    if (allowed.left > 0 && stripIntersectsOtherDisplay({
      x: area.x - allowed.left,
      y: candidate.y,
      width: allowed.left,
      height: candidate.height,
    }, others)) {
      next.left = 0
    }
    if (allowed.right > 0 && stripIntersectsOtherDisplay({
      x: area.x + area.width,
      y: candidate.y,
      width: allowed.right,
      height: candidate.height,
    }, others)) {
      next.right = 0
    }

    if (sameInsets(allowed, next)) return candidate
    allowed = next
  }

  return clampWindowBounds(bounds, display.workArea, allowed)
}

function stripIntersectsOtherDisplay(strip: WindowBounds, others: readonly Display[]): boolean {
  return strip.width > 0
    && strip.height > 0
    && others.some((other) => intersects(strip, other.bounds))
}

function sameInsets(a: WindowInsets, b: WindowInsets): boolean {
  return a.top === b.top
    && a.right === b.right
    && a.bottom === b.bottom
    && a.left === b.left
}

function intersects(a: WindowBounds, b: WindowBounds): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
}

function getCursorDisplay(): Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

/** {@link resolveTargetDisplay} 的可选上下文 */
export type ResolveTargetDisplayContext = {
  /** 重新定位窗口时排除窗口自身，避免 focused-window 解析成原地不动 */
  exclude?: BrowserWindow
}

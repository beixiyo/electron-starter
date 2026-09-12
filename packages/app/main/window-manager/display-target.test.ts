/**
 * 多屏落位与透明留白收敛
 *
 * 覆盖单屏开发机无法发现的两类错误：预设位误用主屏坐标，以及留白探入叠放屏后被
 * 系统二次收敛到错误位置
 */

import type { Display } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clampWindowBoundsToDisplay, resolveTargetDisplay } from './display-target'
import { calculateWindowPosition } from './window-factory'

const harness = vi.hoisted(() => {
  const primary = {
    id: 1,
    bounds: { x: 0, y: 0, width: 1600, height: 1000 },
    workArea: { x: 0, y: 0, width: 1600, height: 1000 },
    workAreaSize: { width: 1600, height: 1000 },
  }
  const secondary = {
    id: 2,
    bounds: { x: 1600, y: -200, width: 2560, height: 1400 },
    workArea: { x: 1600, y: -200, width: 2560, height: 1400 },
    workAreaSize: { width: 2560, height: 1400 },
  }
  const below = {
    id: 3,
    bounds: { x: 1600, y: 1200, width: 1280, height: 800 },
    workArea: { x: 1600, y: 1200, width: 1280, height: 800 },
    workAreaSize: { width: 1280, height: 800 },
  }

  return {
    primary,
    secondary,
    below,
    displays: [primary, secondary] as Array<typeof primary>,
    cursor: { x: 2000, y: 300 },
    focused: null as { getBounds: () => { x: number; y: number; width: number; height: number }; isDestroyed: () => boolean } | null,
  }
})

function displayAt(point: { x: number; y: number }) {
  return harness.displays.find(({ workArea }) =>
    point.x >= workArea.x
    && point.x < workArea.x + workArea.width
    && point.y >= workArea.y
    && point.y < workArea.y + workArea.height
  ) ?? harness.primary
}

vi.mock('electron', () => ({
  app: { getAppPath: () => '/app' },
  BrowserWindow: { getFocusedWindow: () => harness.focused },
  screen: {
    getPrimaryDisplay: () => harness.primary,
    getAllDisplays: () => harness.displays,
    getCursorScreenPoint: () => harness.cursor,
    getDisplayNearestPoint: displayAt,
  },
}))

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../logging/window-diagnostics', () => ({ attachWindowDiagnostics: vi.fn() }))

beforeEach(() => {
  harness.cursor = { x: 2000, y: 300 }
  harness.focused = null
  harness.displays = [harness.primary, harness.secondary]
})

describe('目标屏解析与预设位', () => {
  it('缺省跟随光标所在的副屏，并使用副屏的负坐标原点', () => {
    const display = resolveTargetDisplay()
    const position = calculateWindowPosition({
      position: 'center',
      width: 400,
      height: 100,
      display,
    })

    expect(display.id).toBe(harness.secondary.id)
    expect(position).toEqual({
      x: harness.secondary.workArea.x + (harness.secondary.workArea.width - 400) / 2,
      y: harness.secondary.workArea.y + (harness.secondary.workArea.height - 100) / 2,
    })
  })

  it('focused-window 排除自身后回落到光标屏，拔掉指定屏也回落', () => {
    const focused = {
      getBounds: () => ({ x: 100, y: 100, width: 400, height: 300 }),
      isDestroyed: () => false,
    }
    harness.focused = focused

    expect(resolveTargetDisplay('focused-window', { exclude: focused as never }).id)
      .toBe(harness.secondary.id)
    expect(resolveTargetDisplay({ displayId: 999 }).id).toBe(harness.secondary.id)
  })
})

describe('相邻屏上的透明留白', () => {
  const secondary = harness.secondary as unknown as Display
  const insets = { top: 30, right: 30, bottom: 30, left: 30 }
  const base = {
    x: 1800,
    y: harness.secondary.workArea.y + harness.secondary.workArea.height - 100 + 22,
    width: 171,
    height: 100,
  }

  it('没有相邻屏时仍允许留白越过虚拟桌面边缘', () => {
    expect(clampWindowBoundsToDisplay(base, secondary, insets)).toEqual(base)
  })

  it('留白探入下方相邻屏时只收回这一侧', () => {
    harness.displays = [harness.primary, harness.secondary, harness.below]

    expect(clampWindowBoundsToDisplay(base, secondary, insets)).toEqual({
      ...base,
      y: harness.secondary.workArea.y + harness.secondary.workArea.height - base.height,
    })
  })

  it('相邻屏没有覆盖窗口自己的横向区间时仍允许留白探出', () => {
    harness.displays = [harness.primary, harness.secondary, harness.below]
    const clear = { ...base, x: harness.below.bounds.x + harness.below.bounds.width + 10 }

    expect(clampWindowBoundsToDisplay(clear, secondary, insets)).toEqual(clear)
  })

  it('先被目标屏右边界收进来的窗口也要检查候选 strip', () => {
    const rightEdgeDisplay = {
      id: 4,
      bounds: { x: 1500, y: 1000, width: 100, height: 800 },
      workArea: { x: 1500, y: 1000, width: 100, height: 800 },
      workAreaSize: { width: 100, height: 800 },
    }
    harness.displays = [harness.primary, rightEdgeDisplay]

    const outside = { ...base, x: 2000 }
    expect(clampWindowBoundsToDisplay(outside, harness.primary as unknown as Display, insets)).toEqual({
      ...outside,
      x: harness.primary.workArea.x + harness.primary.workArea.width - outside.width + insets.right,
      y: harness.primary.workArea.y + harness.primary.workArea.height - outside.height,
    })
  })
})

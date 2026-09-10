/**
 * 底部浮层的可见基线：预设落点、边界收敛、系统收敛开关必须给出同一个净空
 *
 * 这里锁的是一个只在真机上看得见的失败：位置计算把窗口摆到工作区底边**以下**
 * （透明阴影留白要占住那段），只要有任何一环仍按窗口边计量，那段留白就会被当成
 * 越界收回来，可见内容离底从净空值变成一个完整的 inset
 */

import { BOTTOM_FLOATING_CLEARANCE, clampWindowBounds, PHYSICAL_WINDOW_CONFIGS, resolveVisibleContentInsets, SHADOW_INSET, WindowType } from '@shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateWindowPosition, createBrowserWindow } from './window-factory'

const display = vi.hoisted(() => ({
  id: 1,
  /** 原点非零：只用 workAreaSize 的实现会在这里露馅 */
  workArea: { x: 100, y: 50, width: 1600, height: 1000 },
  workAreaSize: { width: 1600, height: 1000 },
}))

const harness = vi.hoisted(() => ({
  /** 每次 `new BrowserWindow` 收到的构造参数 */
  constructorOptions: [] as Record<string, unknown>[],
}))

vi.mock('electron', () => {
  class BrowserWindow {
    constructor(options: Record<string, unknown>) {
      harness.constructorOptions.push(options)
    }

    static getFocusedWindow = () => null
    webContents = { on: vi.fn(), isDestroyed: () => false, insertCSS: vi.fn(() => Promise.resolve()) }
    on = vi.fn()
    isDestroyed = () => false
    setAlwaysOnTop = vi.fn()
    setMenuBarVisibility = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    setFullScreenable = vi.fn()
    loadURL = vi.fn()
    loadFile = vi.fn()
  }

  return {
    app: { getAppPath: () => '/app' },
    BrowserWindow,
    screen: {
      getPrimaryDisplay: () => display,
      getAllDisplays: () => [display],
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => display,
    },
  }
})

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../logging/window-diagnostics', () => ({ attachWindowDiagnostics: vi.fn() }))

const config = PHYSICAL_WINDOW_CONFIGS[WindowType.VOICE_IME]
const size = { width: config.width, height: config.height }
const insets = resolveVisibleContentInsets(config)
/** 取渲染层真正画出来的那圈留白，而不是配置里声明的——配置漏声明正是本组要抓的失败 */
const insetBottom = SHADOW_INSET
const workAreaBottom = display.workArea.y + display.workArea.height

/** 窗口边 → 可见内容底边 */
function visibleBottomOf(y: number): number {
  return y + size.height - insetBottom
}

describe('底部浮窗贴底', () => {
  let placed: { x: number; y: number }

  beforeEach(() => {
    placed = calculateWindowPosition({
      position: config.position,
      ...size,
      visibleContentInsets: insets,
    })
  })

  it('预设落点让可见内容压在工作区底边上方一个净空', () => {
    expect(visibleBottomOf(placed.y)).toBe(workAreaBottom - BOTTOM_FLOATING_CLEARANCE)
  })

  it('边界收敛不动这个落点：透明留白允许越过工作区底边', () => {
    const clamped = clampWindowBounds({ ...placed, ...size }, display.workArea, insets)

    expect(clamped.y).toBe(placed.y)
    expect(visibleBottomOf(clamped.y)).toBe(workAreaBottom - BOTTOM_FLOATING_CLEARANCE)
  })

  it('不声明留白的窗口仍被整窗收在工作区内', () => {
    const bounds = { x: 0, y: 0, width: 400, height: 300 }
    const clamped = clampWindowBounds(bounds, display.workArea)

    expect(clamped.x).toBe(display.workArea.x)
    expect(clamped.y).toBe(display.workArea.y)
  })
})

/**
 * 声明留白与解除系统收敛必须成对
 *
 * macOS 的 AppKit 会对普通窗口执行 `constrainFrameRect:toScreen:`，把探出可用区的
 * frame 夹回去；Electron 只在 `enableLargerThanScreen` 打开时跳过它。上一组算出的
 * 落点因此在真机上会在 `show()` 那一刻被夹掉，而纯几何断言看不见这件事
 *
 * 本组只能锁住「声明了留白 ⇒ 一定解除收敛」这条接线（它极易在后续改动中被悄悄拆开，
 * 且拆开后所有几何单测依旧全绿）。系统收敛本身的行为无法在 node 环境断言，
 * 已由独立 Electron 实验进程实测确认
 */
describe('可见内容留白与系统边界收敛的接线', () => {
  beforeEach(() => {
    harness.constructorOptions.length = 0
  })

  it('声明了可见内容留白的窗口解除系统对 frame 的收敛', () => {
    createBrowserWindow(config, undefined, WindowType.VOICE_IME)

    expect(harness.constructorOptions.at(-1)?.enableLargerThanScreen).toBe(true)
  })

  it('内容即窗口的普通窗口保持系统默认收敛', () => {
    createBrowserWindow(PHYSICAL_WINDOW_CONFIGS[WindowType.MAIN], undefined, WindowType.MAIN)

    expect(harness.constructorOptions.at(-1)?.enableLargerThanScreen).toBeFalsy()
  })

  it('可拖动的窗口即便有留白也保持系统默认收敛', () => {
    /** 手写拖动直接 setBounds、自己不夹边，解除收敛就等于允许用户把可见内容拖出屏幕 */
    const movable = PHYSICAL_WINDOW_CONFIGS[WindowType.UTILITY_PANEL_POOL]
    expect(movable.movable).toBe(true)

    createBrowserWindow(movable, undefined, WindowType.UTILITY_PANEL_POOL)

    expect(harness.constructorOptions.at(-1)?.enableLargerThanScreen).toBeFalsy()
  })
})

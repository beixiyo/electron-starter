import { describe, expect, it } from 'vitest'
import { resolveAppBundlePath } from './app-bundle'
import { computeDragGuideBounds } from './placement'

const CONTENT = { width: 530, height: 109 }
const INSET = 24

describe('resolveAppBundlePath', () => {
  it('returns the outermost bundle when a helper bundle is nested inside the app', () => {
    /**
     * 从内往外找会拖出 helper bundle，用户在隐私列表里看到的就是一条陌生条目，
     * 而 TCC 授权仍然记在外层应用上——功能看起来「授权了」却依旧不工作
     */
    const path = '/Applications/MyApp.app/Contents/Frameworks/MyApp Helper.app/Contents/MacOS/MyApp Helper'
    expect(resolveAppBundlePath(path)).toBe('/Applications/MyApp.app')
  })

  it('resolves Electron.app in an unpackaged dev tree', () => {
    const path = '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
    expect(resolveAppBundlePath(path)).toBe('/repo/node_modules/electron/dist/Electron.app')
  })

  it('returns null for a bare executable so the caller can degrade instead of dragging nothing', () => {
    expect(resolveAppBundlePath('/usr/local/bin/myapp')).toBeNull()
  })
})

describe('computeDragGuideBounds', () => {
  const workArea = { x: 0, y: 25, width: 1920, height: 1055 }

  it('subtracts the shadow inset so the visible content lands where it was computed', () => {
    /**
     * 窗口矩形与可见内容差了一圈透明阴影。忘记扣这一圈，卡片就会整体偏移 INSET，
     * 本仓库在 VOICE_IME_SHADOW_INSET 上已经踩过同一类错位
     */
    const settings = { x: 600, y: 100, width: 720, height: 840 }
    const bounds = computeDragGuideBounds(settings, workArea, CONTENT, INSET)

    expect(bounds.width).toBe(CONTENT.width + INSET * 2)
    expect(bounds.height).toBe(CONTENT.height + INSET * 2)

    const contentX = bounds.x + INSET
    /** 水平居中于系统设置窗口 */
    expect(contentX).toBe(600 + (720 - CONTENT.width) / 2)
  })

  it('keeps the visible content on screen when System Settings hangs off the bottom edge', () => {
    /**
     * 系统设置被拖到屏幕下缘时，按「贴其底部」算出的 y 会越过工作区，
     * 卡片有一半在屏幕外——正是引导最需要被看见的时候看不见
     */
    const settings = { x: 600, y: 900, width: 720, height: 840 }
    const bounds = computeDragGuideBounds(settings, workArea, CONTENT, INSET)

    const contentBottom = bounds.y + INSET + CONTENT.height
    expect(contentBottom).toBeLessThanOrEqual(workArea.y + workArea.height)
  })

  it('keeps the visible content on screen when System Settings hangs off the right edge', () => {
    const settings = { x: 1700, y: 100, width: 720, height: 840 }
    const bounds = computeDragGuideBounds(settings, workArea, CONTENT, INSET)

    const contentRight = bounds.x + INSET + CONTENT.width
    expect(contentRight).toBeLessThanOrEqual(workArea.x + workArea.width)
  })

  it('anchors to the top-left corner when the card cannot fit the work area at all', () => {
    /** 卡片比工作区还宽时宁可右侧被裁，也不能让文案起始处跑到屏幕外 */
    const narrow = { x: 0, y: 0, width: 400, height: 300 }
    const settings = { x: 0, y: 0, width: 400, height: 300 }
    const bounds = computeDragGuideBounds(settings, narrow, CONTENT, INSET)

    expect(bounds.x + INSET).toBeGreaterThanOrEqual(narrow.x)
    expect(bounds.y + INSET).toBeGreaterThanOrEqual(narrow.y)
  })
})

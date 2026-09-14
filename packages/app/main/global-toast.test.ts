/** 全局提示的定位、替换计时与过期测量保护 */

import type { BrowserWindow } from 'electron'
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const setBounds = vi.fn()
const setIgnoreMouseEvents = vi.fn()
const getBounds = vi.fn(() => ({ x: 660, y: 900, width: 340, height: 132 }))

const toastWindow = {
  isDestroyed: () => false,
  isVisible: () => true,
  setBounds,
  setIgnoreMouseEvents,
}
const voiceImeWindow = Object.assign(new EventEmitter(), {
  isDestroyed: () => false,
  isVisible: () => true,
  getBounds,
})

let voiceImeVisible = true

vi.mock('electron', () => ({
  screen: {
    getCursorScreenPoint: () => ({ x: 800, y: 500 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1600, height: 1000 } }),
  },
}))

vi.mock('./logging', () => ({
  createMainDiagnosticLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

/** 浮层渲染层上报的壳高；浮层窗口固定为最大一档，胶囊顶边只能靠它从底边往上算 */
const shellHeightState = vi.hoisted(() => ({ current: 40 }))
vi.mock('@ipc/services/voice-ime/state', () => ({
  getVoiceImeShellMetrics: () => ({ width: 140, height: shellHeightState.current }),
}))

vi.mock('@ipc/services/global-toast/toRenderer', () => ({
  globalToastToRenderer: { emit: vi.fn() },
}))

vi.mock('./window-manager', () => ({
  logicalWindowManager: {
    create: () => toastWindow,
    showInactive: vi.fn(),
    hide: vi.fn(),
    getTargetWindow: (type: string) =>
      type === 'voice-ime'
        ? voiceImeVisible
          ? voiceImeWindow
          : undefined
        : toastWindow,
  },
  windowManager: {
    getMetadata: () => ({ config: { visibleContentInsets: { top: 30 } } }),
    get: (type: string) => {
      if (type === 'voice-ime') {
        return voiceImeVisible
          ? voiceImeWindow
          : undefined
      }
      return toastWindow
    },
  },
}))

const {
  GLOBAL_TOAST_EDGE_OFFSET,
  GLOBAL_TOAST_GAP,
  GLOBAL_TOAST_SHADOW_INSET,
  SHADOW_INSET,
} = await import('@shared')
const { globalToastToRenderer } = await import('@ipc/services/global-toast/toRenderer')
const {
  applyGlobalToastMeasurement,
  getCurrentGlobalToast,
  hideGlobalToast,
  showGlobalToast,
  setGlobalToastNoticeTargetResolver,
} = await import('./global-toast')

const emit = globalToastToRenderer.emit as unknown as ReturnType<typeof vi.fn>

function dismissCount(): number {
  return emit.mock.calls.filter(([event, payload]) => event === 'render' && payload === null).length
}

function currentToken(): number {
  const last = emit.mock.calls.filter(([event, payload]) => event === 'render' && payload).at(-1)
  return (last![1] as { token: number }).token
}

function lastBounds() {
  return setBounds.mock.calls.at(-1)![0] as { x: number; y: number; width: number; height: number }
}

describe('全局提示', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setBounds.mockClear()
    setIgnoreMouseEvents.mockClear()
    voiceImeVisible = true
    shellHeightState.current = 40
    hideGlobalToast()
    setGlobalToastNoticeTargetResolver(() => null)
    voiceImeWindow.removeAllListeners()
    emit.mockClear()
  })

  it('按两种真实留白贴在 Voice IME 上方并启用鼠标穿透', () => {
    showGlobalToast({ text: '磁盘空间不足' })
    applyGlobalToastMeasurement(currentToken(), 200, 40)

    const bounds = lastBounds()
    const toastVisibleBottom = bounds.y + GLOBAL_TOAST_SHADOW_INSET + 40
    /** 浮层窗口固定、壳贴底：可见顶边 = 窗口底边 − 底边留白 − 上报壳高 */
    const anchorVisibleTop = 900 + 132 - SHADOW_INSET - 40

    expect(anchorVisibleTop - toastVisibleBottom).toBe(GLOBAL_TOAST_GAP)
    expect(bounds.x + GLOBAL_TOAST_SHADOW_INSET).toBe(660 + (340 - 200) / 2)
    expect(setIgnoreMouseEvents).toHaveBeenCalledWith(true)
  })

  it('胶囊顶边跟渲染层上报的壳高走，而不是浮层的窗口顶边', () => {
    /**
     * 浮层窗口固定为最大一档（结果卡那么大），胶囊只占底部一小截：
     * 仍按窗口顶边算的话，提示条会飘在胶囊上方一百多像素的透明区里
     */
    shellHeightState.current = 194
    showGlobalToast({ text: '磁盘空间不足' })
    applyGlobalToastMeasurement(currentToken(), 200, 40)
    const aboveCard = lastBounds().y

    shellHeightState.current = 40
    showGlobalToast({ text: '磁盘空间不足' })
    applyGlobalToastMeasurement(currentToken(), 200, 40)
    const aboveCapsule = lastBounds().y

    expect(aboveCapsule - aboveCard).toBe(194 - 40)
  })

  it('Voice IME 不可见时回落到当前屏幕底部', () => {
    voiceImeVisible = false
    showGlobalToast({ text: '磁盘空间不足' })
    applyGlobalToastMeasurement(currentToken(), 200, 40)

    const bounds = lastBounds()
    const visibleBottom = bounds.y + bounds.height - GLOBAL_TOAST_SHADOW_INSET
    expect(visibleBottom).toBe(1000 - GLOBAL_TOAST_EDGE_OFFSET)
    expect(bounds.x + GLOBAL_TOAST_SHADOW_INSET).toBe((1600 - 200) / 2)
  })

  it('新内容覆盖旧内容并重新计时', () => {
    showGlobalToast({ text: '第一条', duration: 3000 })
    vi.advanceTimersByTime(2900)

    showGlobalToast({ text: '第二条', duration: 3000 })
    vi.advanceTimersByTime(2900)
    expect(dismissCount()).toBe(0)

    vi.advanceTimersByTime(200)
    expect(dismissCount()).toBe(1)
  })

  it('duration 为 0 时保持显示', () => {
    showGlobalToast({ text: '常驻提示', duration: 0 })
    vi.advanceTimersByTime(60_000)

    expect(dismissCount()).toBe(0)
  })

  it('懒建窗口可以拉取当前内容，收起后不残留', () => {
    expect(getCurrentGlobalToast()).toBeNull()

    showGlobalToast({ text: '首次提示' })
    expect(getCurrentGlobalToast()).toMatchObject({ text: '首次提示' })

    hideGlobalToast()
    expect(getCurrentGlobalToast()).toBeNull()
  })

  it('实测尺寸回来后保持调用方指定的落点', () => {
    voiceImeVisible = false
    showGlobalToast({ text: '上传失败', placement: 'top-right', offset: 20 })
    applyGlobalToastMeasurement(currentToken(), 200, 40)

    const bounds = lastBounds()
    expect(bounds.x + GLOBAL_TOAST_SHADOW_INSET).toBe(1600 - 20 - 200)
    expect(bounds.y + GLOBAL_TOAST_SHADOW_INSET).toBe(20)
  })

  it('丢弃上一条提示迟到的尺寸测量', () => {
    showGlobalToast({ text: '第一条' })
    const staleToken = currentToken()

    showGlobalToast({ text: '第二条' })
    applyGlobalToastMeasurement(currentToken(), 200, 40)
    const currentBounds = lastBounds()

    applyGlobalToastMeasurement(staleToken, 460, 40)
    expect(lastBounds()).toEqual(currentBounds)
  })

  it('锚定窗隐藏会收起常驻提示，替换到屏幕落点后旧锚不再拥有关闭权', () => {
    showGlobalToast({ text: '处理失败', duration: 0 })
    voiceImeWindow.emit('hide')
    expect(getCurrentGlobalToast()).toBeNull()
    expect(dismissCount()).toBe(1)

    showGlobalToast({ text: '锚定提示', duration: 0 })
    showGlobalToast({ text: '屏幕提示', duration: 0, placement: 'top' })
    voiceImeWindow.emit('hide')
    expect(getCurrentGlobalToast()?.text).toBe('屏幕提示')
  })

  it('前台登记窗口承载提示，并清除独立浮窗及后续过期测量', () => {
    showGlobalToast({ text: '上一条独立提示', duration: 0 })
    const oldToken = currentToken()
    const host = Object.assign(new EventEmitter(), { isDestroyed: () => false, isVisible: () => true, isFocused: () => true }) as unknown as BrowserWindow
    const detach = setGlobalToastNoticeTargetResolver(() => host)
    setBounds.mockClear()

    showGlobalToast({ text: '窗口内提示', duration: 0 })
    expect(emit).toHaveBeenLastCalledWith('notice', expect.objectContaining({ text: '窗口内提示' }), host)
    expect(getCurrentGlobalToast()).toBeNull()
    applyGlobalToastMeasurement(oldToken, 999, 999)
    expect(setBounds).not.toHaveBeenCalled()

    hideGlobalToast()
    expect(emit).toHaveBeenLastCalledWith('notice', null, host)
    detach()
  })
})

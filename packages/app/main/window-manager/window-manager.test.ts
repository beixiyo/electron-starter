import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WindowType } from '@shared'
import { windowManager } from './window-manager'
import { createBrowserWindow } from './window-factory'

vi.mock('./window-factory', () => ({
  createBrowserWindow: vi.fn(),
}))

vi.mock('electron', () => ({
  screen: {
    getPrimaryDisplay: () => ({
      id: 1,
      bounds: { x: 0, y: 0, width: 1600, height: 1000 },
      workArea: { x: 0, y: 0, width: 1600, height: 1000 },
      workAreaSize: { width: 1600, height: 1000 },
    }),
    getDisplayNearestPoint: () => ({
      id: 1,
      bounds: { x: 0, y: 0, width: 1600, height: 1000 },
      workArea: { x: 0, y: 0, width: 1600, height: 1000 },
      workAreaSize: { width: 1600, height: 1000 },
    }),
    getAllDisplays: () => [],
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  },
}))

class FakeWebContents extends EventEmitter {
  loading = true
  destroyed = false

  isLoading(): boolean {
    return this.loading
  }

  isDestroyed(): boolean {
    return this.destroyed
  }
}

class FakeWindow extends EventEmitter {
  webContents = new FakeWebContents()
  showInactive = vi.fn(() => {
    this.visible = true
  })
  show = vi.fn(() => {
    this.visible = true
  })
  focus = vi.fn()
  setAlwaysOnTop = vi.fn()
  isMinimized = vi.fn(() => false)
  isDestroyed = vi.fn(() => this.destroyed)
  isVisible = vi.fn(() => this.visible)
  getBounds = vi.fn(() => ({ x: 0, y: 0, width: 400, height: 300 }))
  setBounds = vi.fn()
  setPosition = vi.fn()
  close = vi.fn()
  minimize = vi.fn()
  isFullScreen = vi.fn(() => false)
  setFullScreen = vi.fn()
  visible = false
  destroyed = false

  destroy(): void {
    this.destroyed = true
    this.webContents.destroyed = true
    this.emit('closed')
  }
}

afterEach(() => {
  windowManager.destroy(WindowType.MAIN)
  vi.clearAllMocks()
})

describe('窗口展示队列', () => {
  it('即时展示会取消之前等待加载完成的旧回调', () => {
    const window = new FakeWindow()
    vi.mocked(createBrowserWindow).mockReturnValue(window as never)
    expect(windowManager.create(WindowType.MAIN)).toBe(window)

    expect(windowManager.show(WindowType.MAIN)).toBe(true)
    window.webContents.loading = false
    expect(windowManager.showInactive(WindowType.MAIN, { presentWhenLoaded: false })).toBe(true)

    window.webContents.emit('did-finish-load')

    expect(window.showInactive).toHaveBeenCalledTimes(1)
    expect(window.focus).not.toHaveBeenCalled()
  })
})

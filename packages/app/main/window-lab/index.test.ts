import type { WindowLabContract, WindowLabPreview } from '@ipc/services/window-lab/contract'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  nextWindowId: 1,
  createdWindows: [] as FakeWindow[],
  handlers: null as ServiceHandlers | null,
  emitted: vi.fn(),
  ipcHandlers: new Map<string, unknown>(),
  createBrowserWindow: vi.fn(),
  fromWebContents: vi.fn((sender: FakeWebContents) => sender.owner as unknown as Electron.BrowserWindow),
}))

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

vi.mock('@ipc/core/service', () => ({
  createIpcService: vi.fn((_namespace: string, impl: { mainHandle: ServiceHandlers }) => {
    harness.handlers = impl.mainHandle
    return { emit: harness.emitted }
  }),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: harness.fromWebContents,
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: unknown) => {
      harness.ipcHandlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => {
      harness.ipcHandlers.delete(channel)
    }),
  },
  screen: {
    getDisplayNearestPoint: vi.fn(() => ({
      id: 1,
      workArea: { x: 0, y: 0, width: 1600, height: 1000 },
    })),
  },
}))

vi.mock('../window-manager/window-factory', () => ({
  createBrowserWindow: harness.createBrowserWindow,
}))

const { initWindowLab } = await import('./index')

const PREVIEW: WindowLabPreview = {
  target: 'voice-ime',
  theme: 'dark',
  scene: {
    kind: 'recording',
    state: 'listening',
    remainingSeconds: 12,
  },
}

type ServiceHandlers = {
  [K in keyof WindowLabContract['mainHandle']]: (
    event: unknown,
    ...args: any[]
  ) => any
}

type FakeWebContents = EventEmitter & {
  id: number
  loading: boolean
  destroyed: boolean
  owner?: FakeWindow
  isDestroyed: () => boolean
  isLoading: () => boolean
  isLoadingMainFrame: () => boolean
}

type FakeWindow = EventEmitter & {
  webContents: FakeWebContents
  bounds: { x: number; y: number; width: number; height: number }
  visible: boolean
  destroyed: boolean
  show: ReturnType<typeof vi.fn>
  showInactive: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  setBounds: ReturnType<typeof vi.fn>
  getBounds: ReturnType<typeof vi.fn>
  isDestroyed: () => boolean
  destroy: () => void
}

function createFakeWindow(): FakeWindow {
  const webContents = Object.assign(new EventEmitter(), {
    id: harness.nextWindowId++,
    loading: true,
    destroyed: false,
    isDestroyed() {
      return this.destroyed
    },
    isLoading() {
      return this.loading
    },
    isLoadingMainFrame() {
      return this.loading
    },
  }) as FakeWebContents

  const window = Object.assign(new EventEmitter(), {
    webContents,
    bounds: { x: 100, y: 600, width: 400, height: 300 },
    visible: false,
    destroyed: false,
    show: vi.fn(),
    showInactive: vi.fn(),
    focus: vi.fn(),
    setBounds: vi.fn((bounds: FakeWindow['bounds']) => {
      window.bounds = bounds
    }),
    getBounds: vi.fn(() => window.bounds),
    isDestroyed() {
      return window.destroyed
    },
    destroy() {
      if (window.destroyed) return
      window.destroyed = true
      webContents.destroyed = true
      window.emit('closed')
      webContents.emit('destroyed')
    },
  }) as FakeWindow

  window.show.mockImplementation(() => {
    window.visible = true
  })
  window.showInactive.mockImplementation(() => {
    window.visible = true
  })
  webContents.owner = window
  return window
}

function eventFor(window: FakeWindow): { sender: FakeWebContents } {
  return { sender: window.webContents }
}

function handlers(): ServiceHandlers {
  if (!harness.handlers) throw new Error('Window Lab service was not initialized')
  return harness.handlers
}

beforeEach(() => {
  harness.nextWindowId = 1
  harness.createdWindows = []
  harness.handlers = null
  harness.emitted.mockReset()
  harness.ipcHandlers.clear()
  harness.createBrowserWindow.mockReset().mockImplementation(() => {
    const window = createFakeWindow()
    harness.createdWindows.push(window)
    return window as unknown as Electron.BrowserWindow
  })
  harness.fromWebContents.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Window Lab 主进程边界', () => {
  it('只允许控制窗控制预览，且只允许预览窗读取和调整自身边界', () => {
    const mainWindow = createFakeWindow()
    const attacker = createFakeWindow()
    const controller = initWindowLab({ resolveMainWindow: () => mainWindow as unknown as Electron.BrowserWindow })
    expect(controller.openControl().success).toBe(true)

    const controlWindow = harness.createdWindows[0]
    const service = handlers()
    expect(service.openControl(eventFor(attacker))).toMatchObject({ success: false })
    expect(service.openControl(eventFor(mainWindow))).toMatchObject({ success: true })
    expect(service.openPreview(eventFor(controlWindow), PREVIEW)).toMatchObject({ success: true })
    expect(service.openPreview(eventFor(controlWindow), {
      ...PREVIEW,
      scene: { kind: 'recording', state: 'listening', remainingSeconds: 181 },
    })).toMatchObject({ success: false })

    const previewWindow = harness.createdWindows[1]
    expect(service.getPreview(eventFor(controlWindow))).toEqual(PREVIEW)
    expect(service.getPreview(eventFor(previewWindow))).toEqual(PREVIEW)
    expect(service.openPreview(eventFor(attacker), PREVIEW)).toMatchObject({ success: false })
    expect(service.closePreview(eventFor(attacker))).toMatchObject({ success: false })
    expect(service.resizeSelf(eventFor(controlWindow), 500, 400)).toMatchObject({ success: false })
    expect(service.getSelfBounds(eventFor(controlWindow))).toMatchObject({ success: false })
    expect(service.closePreview(eventFor(previewWindow))).toMatchObject({ success: false })
    expect(service.resizeSelf(eventFor(previewWindow), 500, 400)).toMatchObject({ success: true })
    expect(service.getSelfBounds(eventFor(previewWindow))).toMatchObject({ success: true })

    controller.dispose()
  })

  it('主框架加载失败时不展示预览或推送场景', async () => {
    const mainWindow = createFakeWindow()
    const controller = initWindowLab({ resolveMainWindow: () => mainWindow as unknown as Electron.BrowserWindow })
    expect(controller.openControl().success).toBe(true)

    const controlWindow = harness.createdWindows[0]
    const service = handlers()
    expect(service.openPreview(eventFor(controlWindow), PREVIEW)).toMatchObject({ success: true })
    const previewWindow = harness.createdWindows[1]

    previewWindow.webContents.emit('did-fail-load', {}, -2, 'failed', '', true)
    await flushMicrotasks()

    expect(previewWindow.showInactive).not.toHaveBeenCalled()
    expect(harness.emitted).not.toHaveBeenCalledWith('previewChanged', PREVIEW, previewWindow)
    expect(previewWindow.destroyed).toBe(true)
    expect(harness.emitted).toHaveBeenCalledWith('boundsChanged', null, controlWindow)

    expect(service.openPreview(eventFor(controlWindow), PREVIEW)).toMatchObject({ success: true })
    expect(harness.createdWindows[2]).toBeDefined()
    controller.dispose()
  })

  it('关闭后旧预览的迟到加载事件不会唤醒新预览，移动和销毁会通知控制窗', async () => {
    const mainWindow = createFakeWindow()
    const controller = initWindowLab({ resolveMainWindow: () => mainWindow as unknown as Electron.BrowserWindow })
    expect(controller.openControl().success).toBe(true)

    const controlWindow = harness.createdWindows[0]
    const service = handlers()
    expect(service.openPreview(eventFor(controlWindow), PREVIEW)).toMatchObject({ success: true })
    const firstPreview = harness.createdWindows[1]
    firstPreview.webContents.emit('did-finish-load')
    await flushMicrotasks()
    expect(harness.emitted).toHaveBeenCalledOnce()
    expect(harness.emitted).toHaveBeenCalledWith('previewChanged', PREVIEW, firstPreview)
    harness.emitted.mockClear()

    expect(service.closePreview(eventFor(controlWindow))).toMatchObject({ success: true })
    const changedAfterClose = harness.emitted.mock.calls.at(-1)
    expect(changedAfterClose).toEqual(['boundsChanged', null, controlWindow])

    const nextPreview = { ...PREVIEW, scene: { kind: 'prompt' as const } }
    expect(service.openPreview(eventFor(controlWindow), nextPreview)).toMatchObject({ success: true })
    const secondPreview = harness.createdWindows[2]
    firstPreview.webContents.emit('did-finish-load')
    expect(harness.emitted).not.toHaveBeenCalledWith('previewChanged', nextPreview, firstPreview)

    secondPreview.webContents.emit('did-finish-load')
    await flushMicrotasks()
    secondPreview.emit('move')
    expect(harness.emitted).toHaveBeenCalledWith('previewChanged', nextPreview, secondPreview)
    expect(harness.emitted).toHaveBeenCalledWith('boundsChanged', secondPreview.bounds, controlWindow)

    expect(service.closePreview(eventFor(controlWindow))).toMatchObject({ success: true })
    expect(harness.emitted).toHaveBeenLastCalledWith('boundsChanged', null, controlWindow)
    controller.dispose()
    expect(controlWindow.destroyed).toBe(true)
  })
})

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

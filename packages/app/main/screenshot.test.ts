/**
 * 截图目标投递回归：无申请方会话必须在启动瞬间冻结目标，后续焦点变化、会话替换或
 * 目标销毁都不能把结果改投给另一个窗口；渲染端显式 owner 仍优先。旧实现没有目标
 * 裁决入口，ownerless 完成事件会直接丢失，这组测试直接调用主进程生产流程覆盖该失败
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  nextOverlayContentsId: 1000,
  display: {
    id: 1,
    bounds: { x: 0, y: 0, width: 1200, height: 800 },
    scaleFactor: 1,
  },
  captureResults: [{
    displayId: 1,
    bounds: { x: 0, y: 0, width: 1200, height: 800 },
    scaleX: 1,
    scaleY: 1,
    pngBuffer: Buffer.from('screen'),
  }],
  clipboardWriteImage: vi.fn(),
  showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
}))

vi.mock('electron', () => {
  class FakeBrowserWindow {
    readonly webContents = {
      id: ++harness.nextOverlayContentsId,
      once: () => {},
      isDestroyed: () => false,
    }
    private destroyed = false

    loadFile = async () => {}
    loadURL = async () => {}
    showInactive = () => {}
    focus = () => {}
    hide = () => {}
    setOpacity = () => {}
    setWindowButtonVisibility = () => {}
    setVisibleOnAllWorkspaces = () => {}
    getBounds = () => harness.display.bounds
    setBounds = () => {}
    isDestroyed = () => this.destroyed

    once(_event: string, _listener: (...args: unknown[]) => void): void {}

    destroy(): void {
      this.destroyed = true
    }
  }

  return {
    app: {
      getAppPath: () => '/app',
      once: () => {},
    },
    BrowserWindow: FakeBrowserWindow,
    clipboard: {
      writeImage: harness.clipboardWriteImage,
    },
    dialog: {
      showSaveDialog: harness.showSaveDialog,
    },
    nativeImage: {
      createFromBuffer: () => ({
        isEmpty: () => false,
        crop: () => ({
          isEmpty: () => false,
          toPNG: () => Buffer.from('cropped'),
        }),
      }),
    },
    screen: {
      getAllDisplays: () => [harness.display],
      getCursorScreenPoint: () => ({ x: 100, y: 100 }),
      getDisplayNearestPoint: () => harness.display,
    },
    webContents: {
      fromId: () => undefined,
    },
  }
})

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('./logging', () => ({
  createMainDiagnosticLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))
vi.mock('./permission-required', () => ({ ensureScreenPermissionOrExplain: () => {} }))
vi.mock('./permissions', () => ({
  getPermissionStatus: () => 'granted',
  requestPermission: async () => 'granted',
}))
vi.mock('./screenshot-capture', () => ({
  captureAllDisplays: async () => harness.captureResults,
  warmMacScreenshotCapture: async () => {},
}))
vi.mock('./utils/ipc-buffer', () => ({
  toIpcArrayBuffer: (buffer: Buffer) => Uint8Array.from(buffer).buffer,
}))
vi.mock('./window-manager', () => ({
  windowManager: {
    get: () => undefined,
  },
}))

const {
  handleCancelCapture,
  handleConfirmCapture,
  handleSaveCapture,
  setScreenshotEmitter,
  setScreenshotTargetResolver,
  startCapture,
} = await import('./screenshot')

type FakeTarget = {
  id: number
  destroyed: boolean
  isDestroyed: () => boolean
}

const emitter = {
  emit: vi.fn(),
}

function createTarget(id: number): FakeTarget {
  const target = {
    id,
    destroyed: false,
    isDestroyed: () => target.destroyed,
  }
  return target
}

function asWebContents(target: FakeTarget): Electron.WebContents {
  return target as unknown as Electron.WebContents
}

function events(name: string): Array<[string, unknown, unknown]> {
  return emitter.emit.mock.calls.filter(([event]) => event === name) as Array<[string, unknown, unknown]>
}

beforeEach(() => {
  emitter.emit.mockClear()
  harness.clipboardWriteImage.mockClear()
  harness.showSaveDialog.mockClear()
  setScreenshotEmitter(emitter as never)
})

afterEach(() => {
  handleCancelCapture()
  setScreenshotTargetResolver(null)
  emitter.emit.mockClear()
})

describe('截图会话投递目标', () => {
  it('无申请方结果沿用启动瞬间的目标，不随裁决结果变化', async () => {
    const first = createTarget(1)
    const second = createTarget(2)
    const resolver = vi.fn(() => ({
      webContents: asWebContents(first),
      fallbackRole: 'preview',
    }))
    setScreenshotTargetResolver(resolver)

    await startCapture()
    resolver.mockReturnValue({ webContents: asWebContents(second), fallbackRole: 'other' })
    await handleConfirmCapture(1, { x: 0, y: 0, width: 10, height: 10 })

    expect(resolver).toHaveBeenCalledOnce()
    const [event, payload, target] = events('ok')[0]
    expect(event).toBe('ok')
    expect(target).toBe(first)
    expect(payload).toMatchObject({ captureId: expect.any(String), fallbackRole: 'preview' })
  })

  it('取消沿用冻结目标，目标销毁后不改投给新目标', async () => {
    const first = createTarget(3)
    const second = createTarget(4)
    const resolver = vi.fn(() => ({ webContents: asWebContents(first), fallbackRole: 'preview' }))
    setScreenshotTargetResolver(resolver)

    await startCapture()
    resolver.mockReturnValue({ webContents: asWebContents(second), fallbackRole: 'other' })
    handleCancelCapture()

    const [event, payload, target] = events('cancel')[0]
    expect(event).toBe('cancel')
    expect(target).toBe(first)
    expect(payload).toMatchObject({ captureId: expect.any(String), fallbackRole: 'preview' })

    emitter.emit.mockClear()
    first.destroyed = false
    resolver.mockReturnValue({ webContents: asWebContents(first), fallbackRole: 'preview' })
    await startCapture()
    first.destroyed = true
    resolver.mockReturnValue({ webContents: asWebContents(second), fallbackRole: 'other' })
    await handleConfirmCapture(1, { x: 0, y: 0, width: 10, height: 10 })

    expect(events('ok')).toHaveLength(0)
  })

  it('显式 owner 优先于 resolver，且不附带兜底角色', async () => {
    const owner = createTarget(5)
    const resolver = vi.fn(() => ({ webContents: asWebContents(createTarget(6)), fallbackRole: 'other' }))
    setScreenshotTargetResolver(resolver)

    await startCapture(undefined, asWebContents(owner))
    await handleConfirmCapture(1, { x: 0, y: 0, width: 10, height: 10 })

    expect(resolver).not.toHaveBeenCalled()
    const [, payload, target] = events('ok')[0]
    expect(target).toBe(owner)
    expect(payload).not.toHaveProperty('fallbackRole')
  })

  it('新会话取消旧会话时仍通知旧目标，完成只投新目标', async () => {
    const first = createTarget(7)
    const second = createTarget(8)
    let selected = first
    const resolver = vi.fn(() => ({
      webContents: asWebContents(selected),
      fallbackRole: selected === first
        ? 'first'
        : 'second',
    }))
    setScreenshotTargetResolver(resolver)

    await startCapture()
    selected = second
    await startCapture()

    const cancel = events('cancel')[0]
    expect(cancel?.[2]).toBe(first)
    await handleConfirmCapture(1, { x: 0, y: 0, width: 10, height: 10 })

    const ok = events('ok')[0]
    expect(ok?.[2]).toBe(second)
    expect(events('ok')).toHaveLength(1)
  })

  it('确认让出微任务后旧会话不再投递结果', async () => {
    const first = createTarget(9)
    const second = createTarget(10)
    let selected = first
    setScreenshotTargetResolver(() => ({
      webContents: asWebContents(selected),
      fallbackRole: selected === first
        ? 'first'
        : 'second',
    }))

    await startCapture()
    const replacement = new Promise<void>((resolve) => {
      queueMicrotask(() => {
        selected = second
        void startCapture().then(() => resolve())
      })
    })
    const pendingConfirm = handleConfirmCapture(1, { x: 0, y: 0, width: 10, height: 10 })
    await Promise.all([pendingConfirm, replacement])

    expect(events('ok')).toHaveLength(0)
    expect(events('cancel')[0]?.[2]).toBe(first)
  })

  it('迟到的旧会话确认不清理新会话或写入剪贴板', async () => {
    const first = createTarget(11)
    const second = createTarget(12)
    const rect = { x: 0, y: 0, width: 10, height: 10 }
    const firstCaptureId = await startCapture(undefined, asWebContents(first))
    const secondCaptureId = await startCapture(undefined, asWebContents(second))
    emitter.emit.mockClear()
    harness.clipboardWriteImage.mockClear()

    await handleConfirmCapture(1, rect, firstCaptureId)

    expect(harness.clipboardWriteImage).not.toHaveBeenCalled()
    expect(events('ok')).toHaveLength(0)

    await handleConfirmCapture(1, rect, secondCaptureId)
    expect(events('ok')).toHaveLength(1)
    expect(events('ok')[0]?.[2]).toBe(second)
  })

  it('迟到的旧会话保存不打开保存框且新会话仍可确认', async () => {
    const first = createTarget(13)
    const second = createTarget(14)
    const rect = { x: 0, y: 0, width: 10, height: 10 }
    const firstCaptureId = await startCapture(undefined, asWebContents(first))
    const secondCaptureId = await startCapture(undefined, asWebContents(second))
    emitter.emit.mockClear()
    harness.showSaveDialog.mockClear()

    await handleSaveCapture(1, rect, firstCaptureId)

    expect(harness.showSaveDialog).not.toHaveBeenCalled()
    expect(events('cancel')).toHaveLength(0)

    await handleConfirmCapture(1, rect, secondCaptureId)
    expect(events('ok')).toHaveLength(1)
    expect(events('ok')[0]?.[2]).toBe(second)
  })

  it('迟到的旧会话取消不取消新会话', async () => {
    const first = createTarget(15)
    const second = createTarget(16)
    const rect = { x: 0, y: 0, width: 10, height: 10 }
    const firstCaptureId = await startCapture(undefined, asWebContents(first))
    const secondCaptureId = await startCapture(undefined, asWebContents(second))
    emitter.emit.mockClear()

    handleCancelCapture(firstCaptureId)

    expect(events('cancel')).toHaveLength(0)

    await handleConfirmCapture(1, rect, secondCaptureId)
    expect(events('ok')).toHaveLength(1)
    expect(events('ok')[0]?.[2]).toBe(second)
  })
})

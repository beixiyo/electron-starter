/**
 * 截图 IPC 身份边界：旧覆盖层或普通 renderer 的指令不能穿透到当前会话
 * 直接使用生产 createIpcService 注册 handler，避免只测一层本地 wrapper
 */
import type { ScreenshotSelectionOptions } from '@shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  onHandlers: new Map<string, IpcHandler>(),
  getOverlayInitPayload: vi.fn(),
  handleConfirmCapture: vi.fn(),
  handleSaveCapture: vi.fn(),
  handleCancelCapture: vi.fn(),
  setScreenshotEmitter: vi.fn(),
  startCapture: vi.fn(async () => 'started'),
}))

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {},
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      harness.handlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, handler: IpcHandler) => {
      harness.onHandlers.set(channel, handler)
    }),
  },
}))

vi.mock('@main/screenshot', () => ({
  getOverlayInitPayload: harness.getOverlayInitPayload,
  handleCancelCapture: harness.handleCancelCapture,
  handleConfirmCapture: harness.handleConfirmCapture,
  handleSaveCapture: harness.handleSaveCapture,
  setScreenshotEmitter: harness.setScreenshotEmitter,
  startCapture: harness.startCapture,
}))

await import('./service')

function getHandler(name: string): IpcHandler {
  const handler = harness.handlers.get(`screenshot:${name}`)
  if (!handler) throw new Error(`missing screenshot handler: ${name}`)
  return handler
}

const selection: ScreenshotSelectionOptions = {
  captureId: 'current',
  displayId: 2,
  rect: { x: 1, y: 2, width: 10, height: 11 },
}

const currentOverlay = {
  captureId: selection.captureId,
  bytes: new ArrayBuffer(0),
  displayId: selection.displayId,
  scaleX: 1,
  scaleY: 1,
}

describe('screenshot IPC overlay identity', () => {
  beforeEach(() => {
    harness.getOverlayInitPayload.mockReset()
    harness.handleConfirmCapture.mockReset()
    harness.handleSaveCapture.mockReset()
    harness.handleCancelCapture.mockReset()
  })

  it('拒绝旧会话、错误屏幕和普通 renderer 的操作', async () => {
    const event = { sender: { id: 42 } }
    const wrongSenderEvent = { sender: { id: 99 } }
    const missingSenderIdEvent = { sender: {} }
    harness.getOverlayInitPayload.mockImplementation((senderId: unknown) => (
      senderId === 42
        ? currentOverlay
        : null
    ))

    await getHandler('confirmCapture')(wrongSenderEvent, selection)
    await getHandler('saveCapture')(wrongSenderEvent, selection)
    await getHandler('cancelCapture')(wrongSenderEvent, selection.captureId)

    await getHandler('confirmCapture')(event, {
      ...selection,
      captureId: 'old',
    })
    await getHandler('saveCapture')(event, {
      ...selection,
      displayId: 3,
    })
    await getHandler('cancelCapture')(event, 'old')

    await getHandler('confirmCapture')(event, undefined)
    await getHandler('saveCapture')(event, undefined)
    await getHandler('cancelCapture')(event, undefined)

    await getHandler('confirmCapture')(missingSenderIdEvent, selection)
    await getHandler('saveCapture')(missingSenderIdEvent, selection)
    await getHandler('cancelCapture')(missingSenderIdEvent, selection.captureId)

    expect(harness.handleConfirmCapture).not.toHaveBeenCalled()
    expect(harness.handleSaveCapture).not.toHaveBeenCalled()
    expect(harness.handleCancelCapture).not.toHaveBeenCalled()
  })

  it('只向匹配当前覆盖层的会话转发确认、保存和取消', async () => {
    const event = { sender: { id: 42 } }
    harness.getOverlayInitPayload.mockReturnValue(currentOverlay)

    await getHandler('confirmCapture')(event, selection)
    await getHandler('saveCapture')(event, selection)
    await getHandler('cancelCapture')(event, selection.captureId)

    expect(harness.handleConfirmCapture).toHaveBeenCalledWith(
      selection.displayId,
      selection.rect,
      selection.captureId,
    )
    expect(harness.handleSaveCapture).toHaveBeenCalledWith(
      selection.displayId,
      selection.rect,
      selection.captureId,
    )
    expect(harness.handleCancelCapture).toHaveBeenCalledWith(selection.captureId)
  })
})

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

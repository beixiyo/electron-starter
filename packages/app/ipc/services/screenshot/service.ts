import type { ScreenshotBounds } from '@shared'
import type { IpcMainInvokeEvent } from 'electron'
import type { ScreenshotContract } from './contract'
import { createIpcService } from '@ipc/core'
import {
  getOverlayInitPayload,
  handleCancelCapture,
  handleConfirmCapture,
  handleSaveCapture,
  setScreenshotEmitter,
  startCapture,
} from '@main/screenshot'

export const screenshotService = createIpcService<ScreenshotContract>('screenshot', {
  mainHandle: {
  /** 申请截图会话：记录发起方 webContents，返回主进程生成的 captureId */
    async startCapture(e, options) {
      const captureId = await startCapture(options, (e as IpcMainInvokeEvent).sender)
      return { captureId }
    },

    async confirmCapture(_e, displayId: number, rect: ScreenshotBounds) {
      return handleConfirmCapture(displayId, rect)
    },

    async saveCapture(_e, displayId: number, rect: ScreenshotBounds) {
      return handleSaveCapture(displayId, rect)
    },

    async cancelCapture(_e) {
      return handleCancelCapture()
    },

    async requestInit(e) {
      return getOverlayInitPayload((e as IpcMainInvokeEvent).sender.id)
    },
  },
})

/** screenshot 模块与 service 相互依赖，通过注入保持文件级依赖单向 */
setScreenshotEmitter(screenshotService)

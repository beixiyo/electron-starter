/** 截图 IPC：申请者定向收图，覆盖层指令同时校验窗口、屏幕与会话身份。 */
import type { IpcMainInvokeEvent } from 'electron'
import type { ScreenshotContract } from './contract'
import { createIpcService } from '@ipc/core/service'
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

    async confirmCapture(e, options) {
      if (!options || !matchesOverlay(e as IpcMainInvokeEvent, options.captureId, options.displayId))
        return
      return handleConfirmCapture(options.displayId, options.rect, options.captureId)
    },

    async saveCapture(e, options) {
      if (!options || !matchesOverlay(e as IpcMainInvokeEvent, options.captureId, options.displayId))
        return
      return handleSaveCapture(options.displayId, options.rect, options.captureId)
    },

    async cancelCapture(e, captureId) {
      if (!matchesOverlay(e as IpcMainInvokeEvent, captureId))
        return
      return handleCancelCapture(captureId)
    },

    async requestInit(e) {
      return getOverlayInitPayload((e as IpcMainInvokeEvent).sender.id)
    },
  },
})

/** screenshot 模块与 service 相互依赖，通过注入保持文件级依赖单向 */
setScreenshotEmitter(screenshotService)

/** 旧会话、普通窗口以及别的屏幕均不能操作当前覆盖层。 */
function matchesOverlay(event: IpcMainInvokeEvent, captureId: string, displayId?: number): boolean {
  if (typeof captureId !== 'string' || !captureId)
    return false
  const init = getOverlayInitPayload(event.sender.id)
  return init?.captureId === captureId
    && (displayId === undefined || init.displayId === displayId)
}

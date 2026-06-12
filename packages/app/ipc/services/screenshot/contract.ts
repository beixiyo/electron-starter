import type { IpcContract } from '@ipc/core'
import type {
  ScreenshotBounds,
  ScreenshotCancelPayload,
  ScreenshotInitPayload,
  ScreenshotOkPayload,
  ScreenshotStartOptions,
  ScreenshotStartResult,
} from '@shared'

/**
 * 截图服务契约（会话申请制）
 *
 * - `startCapture` 返回主进程生成的 `captureId`，同一时刻仅一个活跃会话，
 *   新申请会作废旧会话（旧 owner 收到定向 `cancel` 事件）
 * - `ok` / `cancel` 事件只定向发给会话发起方 webContents，
 *   payload 携带 `captureId`，消费方需校验后再消费
 * - 保存到文件（`saveCapture`）不投递图片，结束时发 `cancel` 让发起方清理会话
 */
export type ScreenshotContract = IpcContract<{
  startCapture: (options?: ScreenshotStartOptions) => ScreenshotStartResult
  confirmCapture: (displayId: number, rect: ScreenshotBounds) => void
  saveCapture: (displayId: number, rect: ScreenshotBounds) => void
  cancelCapture: () => void
}, {
  init: ScreenshotInitPayload
  ok: ScreenshotOkPayload
  cancel: ScreenshotCancelPayload
}>

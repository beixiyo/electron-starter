import { registerMediaHandlers } from './services/media/register'
import { registerScreenshotHandlers } from './services/screenshot/register'
import { registerSelectionHandlers } from './services/selection/register'
import { registerWindowHandlers } from './services/window/register'

/**
 * 注册所有 IPC 处理器
 */
export function registerAllIpcHandlers(): void {
  registerWindowHandlers()
  registerMediaHandlers()
  registerSelectionHandlers()
  registerScreenshotHandlers()
}

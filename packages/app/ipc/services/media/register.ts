import { registerIpcMain } from '@ipc/core'
import { mediaHandlers } from './handlers'

/**
 * 注册 Media IPC 处理器
 */
export function registerMediaHandlers(): void {
  registerIpcMain(mediaHandlers, { namespace: 'media' })
}

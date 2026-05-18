import { registerIpcMain } from '@ipc/core'
import { windowHandlers } from './handlers'

export * from './events'

/**
 * 注册 Window IPC 处理器
 */
export function registerWindowHandlers(): void {
  registerIpcMain(windowHandlers, { namespace: 'window' })
}

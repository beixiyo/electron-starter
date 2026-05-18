import { registerIpcMain } from '@ipc/core'
import { selectionHandlers } from './handlers'

/**
 * 注册 Selection IPC 处理器
 */
export function registerSelectionHandlers(): void {
  registerIpcMain(selectionHandlers, { namespace: 'selection' })
}

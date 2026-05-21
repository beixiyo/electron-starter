import type { IpcContract, IpcEmitter, ServiceHandlers } from './contract'
import { BrowserWindow, ipcMain } from 'electron'

/**
 * 在主进程注册 IPC 服务
 *
 * 自动将契约中的 invoke 方法注册为 `ipcMain.handle`，
 * 并返回类型安全的事件发射器用于向渲染进程推送事件
 *
 * @param namespace 服务命名空间，channel 格式为 `namespace:method`
 * @param handlers handler 实现，类型从契约自动推导
 * @returns 事件发射器
 */
export function createIpcService<C extends IpcContract>(
  namespace: string,
  handlers: ServiceHandlers<C>,
): IpcEmitter<C> {
  for (const [method, handler] of Object.entries(handlers)) {
    const channel = `${namespace}:${method}`
    ipcMain.handle(channel, async (...args: unknown[]) => {
      try {
        return await (handler as (...a: unknown[]) => unknown)(...args)
      }
      catch (error) {
        console.error(`[IPC] ${channel} error:`, error)
        throw error
      }
    })
  }

  return {
    emit(event, payload, target?) {
      const channel = `${namespace}:${String(event)}`

      if (target) {
        if (!target.isDestroyed())
          target.webContents.send(channel, payload)
        return
      }

      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed())
          win.webContents.send(channel, payload)
      }
    },
  }
}

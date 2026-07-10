import type { IpcContract, IpcEmitter, ServiceHandlers } from './contract'
import { BrowserWindow, ipcMain } from 'electron'

let errorLogger: IpcServiceErrorLogger | null = null

export function setIpcServiceErrorLogger(logger: IpcServiceErrorLogger): void {
  errorLogger = logger
}

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
      const startedAt = Date.now()
      try {
        return await (handler as (...a: unknown[]) => unknown)(...args)
      }
      catch (error) {
        const event = args[0] as { sender?: { id?: number } } | undefined
        const meta = {
          namespace,
          method,
          channel,
          senderWebContentsId: event?.sender?.id,
          durationMs: Date.now() - startedAt,
        }
        if (errorLogger)
          errorLogger(error, meta)
        else
          console.error(`[IPC] ${channel} error`)
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

/** IPC handler 失败时的结构化上下文 */
export type IpcServiceErrorMeta = {
  namespace: string
  method: string
  channel: string
  senderWebContentsId?: number
  durationMs: number
}

export type IpcServiceErrorLogger = (error: unknown, meta: IpcServiceErrorMeta) => void

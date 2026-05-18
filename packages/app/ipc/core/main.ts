import type { IpcConfig, IpcHandlers } from './types'
import { ipcMain } from 'electron'

/**
 * 在主进程中注册IPC处理器
 *
 * @param handlers 包含处理器函数的对象
 * @param config 可选配置
 * @returns 原始的处理器对象（用于类型推断）
 */
export function registerIpcMain<T extends IpcHandlers>(
  handlers: T,
  config: IpcConfig,
): T {
  const { namespace } = config

  if (!ipcMain) {
    console.error('registerIpcMain: ipcMain 未定义。是否在主进程中运行？')
    return handlers
  }

  for (const [key, handler] of Object.entries(handlers)) {
    const channel = namespace
      ? `${namespace}:${key}`
      : key
    ipcMain.handle(channel, async (...args: any[]) => {
      try {
        return await handler(...args)
      }
      catch (error) {
        console.error(`IPC处理器在通道 "${channel}" 中出错：`, error)
        throw error
      }
    })
  }

  return handlers
}

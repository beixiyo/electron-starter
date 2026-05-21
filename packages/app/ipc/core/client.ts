import type { IpcClient, IpcContract } from './contract'
import { ipcRenderer } from 'electron/renderer'

/**
 * 在渲染进程（preload）创建类型安全的 IPC 客户端
 *
 * invoke 方法和事件订阅的类型全部从契约自动推导，
 * `methods` 数组由 TypeScript 约束只能填契约中存在的方法名
 *
 * @param namespace 服务命名空间，需与 `createIpcService` 一致
 * @param methods invoke 方法名列表（运行时需要，类型层面自动校验）
 */
export function createServiceClient<C extends IpcContract>(
  namespace: string,
  methods: readonly (string & keyof C['invoke'])[],
): IpcClient<C> {
  const client: Record<string, unknown> = {}

  for (const method of methods) {
    const channel = `${namespace}:${method}`
    client[method] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
  }

  client.on = (event: string, callback: (payload: unknown) => void) => {
    const channel = `${namespace}:${event}`
    const handler = (_: unknown, data: unknown) => callback(data)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  }

  return client as IpcClient<C>
}

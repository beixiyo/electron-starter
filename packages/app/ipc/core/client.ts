import type { IpcClient, IpcContract } from './contract'
import { ipcRenderer } from 'electron/renderer'

/**
 * 在渲染进程（preload）创建类型安全的 IPC 客户端
 *
 * 三个通道的类型全部从契约自动推导，
 * `methods` 数组由 TypeScript 约束只能填契约 `mainHandle` 中存在的方法名
 *
 * `on`（`rendererOn`）和 `send`（`mainOn`）走名字传参，不需要额外的名单：
 * 契约里声明了就能调，运行时无需枚举
 *
 * @param namespace 服务命名空间，需与 `createIpcService` 一致
 * @param methods `mainHandle` 方法名列表（运行时需要，类型层面自动校验）
 */
export function createServiceClient<C extends IpcContract>(
  namespace: string,
  methods: readonly (string & keyof C['mainHandle'])[],
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

  /** 单向发送：不等待、无返回值，主进程侧的错误不会回传 */
  client.send = (name: string, ...args: unknown[]) => {
    ipcRenderer.send(`${namespace}:${name}`, ...args)
  }

  return client as IpcClient<C>
}

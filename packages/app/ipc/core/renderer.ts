import type { GetIpcType, IpcConfig, IpcHandlers } from './types'
import { ipcRenderer } from 'electron/renderer'

/**
 * 在预加载脚本中创建类型化的 IPC 客户端
 *
 * @template T IPC 处理器的类型（使用 `typeof implementation`）
 * @param config 配置（必须与注册时的配置匹配）
 * @returns 包含类型化方法的普通对象
 */
export function createIpcClient<T extends IpcHandlers>(
  config: IpcConfig & { methods: string[] },
): GetIpcType<T> {
  const { namespace, methods } = config

  if (!ipcRenderer) {
    console.warn('createIpcClient: ipcRenderer 未定义，使用可能失败。')
  }
  const api = {} as GetIpcType<T>

  for (const methodName of methods) {
    (api as any)[methodName] = async (...args: any[]) => {
      const channel = `${namespace}:${String(methodName)}`
      const res = await ipcRenderer.invoke(channel, ...args)
      return res
    }
  }

  return api
}

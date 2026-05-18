/**
 * IPC处理器的基础类型
 * 键是方法名，值是处理器函数
 */
export type IpcHandlers = Record<string, (...args: any[]) => any>

/**
 * IPC注册和客户端创建的配置
 */
export interface IpcConfig {
  namespace: string
}

/**
 * 从实现对象中提取API类型的辅助类型
 * 移除第一个event参数（因为IpcRenderer.invoke不需要发送event），确保返回类型为Promise
 */
export type GetIpcType<T extends IpcHandlers> = {
  [K in keyof T]: (
    ...args: Parameters<T[K]> extends [any, ...infer Rest] ? Rest : Parameters<T[K]>
  ) => Promise<Awaited<ReturnType<T[K]>>>
}

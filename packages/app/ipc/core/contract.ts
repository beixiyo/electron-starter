/**
 * 契约驱动的类型安全 IPC 系统
 *
 * 定义一次契约，主进程和渲染进程自动获得完整类型推导：
 *
 * @example
 * ```ts
 * // 1. 定义契约（shared，纯类型）
 * type ThemeContract = IpcContract<{
 *   getTheme(): string
 *   setTheme(theme: string): void
 * }, {
 *   'theme-changed': { theme: string }
 * }>
 *
 * // 2. 主进程注册（main）
 * const themeService = createIpcService<ThemeContract>('theme', {
 *   async getTheme(_e) { return 'dark' },
 *   async setTheme(_e, theme) { store.set('theme', theme) },
 * })
 * themeService.emit('theme-changed', { theme: 'dark' })
 *
 * // 3. 渲染进程客户端（preload）
 * const themeClient = createServiceClient<ThemeContract>('theme', ['getTheme', 'setTheme'])
 * // themeClient.getTheme()                              → Promise<string>
 * // themeClient.on('theme-changed', ({ theme }) => {})  → () => void
 * ```
 */

/**
 * IPC 服务契约
 *
 * @template H invoke 方法签名（renderer 调用 → main 处理）— **不含** event 首参
 * @template E 事件载荷映射（main 推送 → renderer 监听）
 */
export type IpcContract<
  H extends Record<string, (...args: any[]) => any> = Record<string, (...args: any[]) => any>,
  E extends Record<string, unknown> = {},
> = {
  invoke: H
  events: E
}

/**
 * 主进程 handler 实现类型
 *
 * 从契约 invoke 签名自动推导，在每个方法前添加 `event` 首参
 */
export type ServiceHandlers<C extends IpcContract> = {
  [K in keyof C['invoke']]: C['invoke'][K] extends (...args: infer A) => infer R
    ? (event: unknown, ...args: A) => R | Promise<R>
    : never
}

/**
 * 主进程事件发射器
 *
 * 从契约 events 映射推导类型安全的 `emit`
 */
export type IpcEmitter<C extends IpcContract> = {
  /**
   * 向渲染进程发送事件
   * @param event 事件名（从契约 events 键推导）
   * @param payload 事件数据（从契约 events 值推导）
   * @param target 目标窗口，不传则广播到所有窗口
   */
  emit: <K extends string & keyof C['events']>(
    event: K,
    payload: C['events'][K],
    target?: Electron.BrowserWindow,
  ) => void
}

/** invoke 方法 → renderer 侧类型（直接调用，返回 Promise） */
type InvokeMethods<C extends IpcContract> = {
  [K in keyof C['invoke']]: C['invoke'][K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never
}

/** 事件订阅方法 */
type EventSubscription<C extends IpcContract> = {
  /**
   * 订阅主进程推送的事件
   * @param event 事件名
   * @param callback 回调
   * @returns 取消订阅函数
   */
  on: <K extends string & keyof C['events']>(
    event: K,
    callback: (payload: C['events'][K]) => void,
  ) => () => void
}

/**
 * 渲染进程 IPC 客户端
 *
 * 合并 invoke 方法（请求/响应）+ 事件订阅（单向监听）
 */
export type IpcClient<C extends IpcContract> = InvokeMethods<C> & EventSubscription<C>

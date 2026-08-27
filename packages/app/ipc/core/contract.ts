/**
 * 契约驱动的类型安全 IPC 系统
 *
 * 定义一次契约，主进程和渲染进程自动获得完整类型推导
 *
 * 三个通道按「哪一端接收」命名，与底层 Electron 注册 API 一一对应：
 *
 * | 契约字段 | 底层 API | 方向 |
 * | --- | --- | --- |
 * | `mainHandle` | `ipcMain.handle` | renderer 调用并等返回值 |
 * | `mainOn` | `ipcMain.on` | renderer 单向发送，无返回值 |
 * | `rendererOn` | `ipcRenderer.on` | main 推送，renderer 订阅 |
 *
 * @example
 * ```ts
 * // 1. 定义契约（shared，纯类型）
 * type ThemeContract = IpcContract<{
 *   mainHandle: {
 *     getTheme: () => string
 *     setTheme: (theme: string) => void
 *   }
 *   mainOn: {
 *     panelClosed: () => void
 *   }
 *   rendererOn: {
 *     'theme-changed': { theme: string }
 *   }
 * }>
 *
 * // 2. 主进程注册（main）——字段名和契约一一对应
 * const themeService = createIpcService<ThemeContract>('theme', {
 *   mainHandle: {
 *     async getTheme(_e) { return 'dark' },
 *     async setTheme(_e, theme) { store.set('theme', theme) },
 *   },
 *   mainOn: {
 *     panelClosed(_e) { releasePanel() },
 *   },
 * })
 * themeService.emit('theme-changed', { theme: 'dark' })
 *
 * // 3. 渲染进程客户端（preload）
 * const themeClient = createServiceClient<ThemeContract>('theme', ['getTheme', 'setTheme'])
 * // themeClient.getTheme()                              → Promise<string>
 * // themeClient.on('theme-changed', ({ theme }) => {})  → () => void
 * // themeClient.send('panelClosed')                     → void
 * ```
 */

/**
 * 契约输入形状
 *
 * 三个通道都可选，未声明的通道视为空。字段签名一律**不含** `event` 首参，
 * event 由 `ServiceHandlers` / `ServiceListeners` 自动补上
 */
export type IpcContractInput = {
  /** renderer 调用并等待返回值，注册为 `ipcMain.handle` */
  mainHandle?: Record<string, (...args: any[]) => any>
  /** renderer 单向发送、不等返回，注册为 `ipcMain.on` */
  mainOn?: Record<string, (...args: any[]) => void>
  /** main 推送、renderer 订阅，事件名 → payload 类型 */
  rendererOn?: Record<string, unknown>
}

/** 未声明的通道归一化成空映射，省去下游到处判 `undefined` */
type Resolve<T, Fallback> = [T] extends [undefined] ? Fallback : NonNullable<T>

/**
 * IPC 服务契约
 *
 * @template T 三个通道的签名，见 {@link IpcContractInput}
 */
export type IpcContract<T extends IpcContractInput = IpcContractInput> = {
  mainHandle: Resolve<T['mainHandle'], Record<never, never>>
  mainOn: Resolve<T['mainOn'], Record<never, never>>
  rendererOn: Resolve<T['rendererOn'], Record<never, never>>
}

/**
 * `mainHandle` 通道的主进程实现类型
 *
 * 从契约签名自动推导，在每个方法前添加 `event` 首参
 */
export type ServiceHandlers<C extends IpcContract> = {
  [K in keyof C['mainHandle']]: C['mainHandle'][K] extends (...args: infer A) => infer R ? (event: unknown, ...args: A) => R | Promise<R>
    : never
}

/**
 * `mainOn` 通道的主进程实现类型
 *
 * 从契约签名自动推导，在每个方法前添加 `event` 首参
 *
 * 单向通道无法回传结果，返回值一律忽略；抛出的错误由 `createIpcService`
 * 兜住并交给 `setIpcServiceErrorLogger`，不会静默丢失
 */
export type ServiceListeners<C extends IpcContract> = {
  [K in keyof C['mainOn']]: C['mainOn'][K] extends (...args: infer A) => any ? (event: Electron.IpcMainEvent, ...args: A) => void
    : never
}

/**
 * `createIpcService` 的实现参数
 *
 * 字段名与契约一致，不用记参数位置。且是**条件必填**：契约声明了哪个通道，
 * 这里就必须实现哪个通道，漏实现或多实现都是编译错误
 */
export type ServiceImpl<C extends IpcContract> =
  & ([keyof C['mainHandle']] extends [never] ? { mainHandle?: never }
    : { mainHandle: ServiceHandlers<C> })
  & ([keyof C['mainOn']] extends [never] ? { mainOn?: never }
    : { mainOn: ServiceListeners<C> })

/**
 * main → renderer 的单向推送面
 *
 * 从契约 `rendererOn` 映射推导类型安全的 `emit`。反方向（renderer → main）不经过它，
 * 走的是契约 `mainHandle`（有返回值）或 `mainOn`（无返回值），实现挂在各服务的 handler 上
 */
export type MainToRendererEmitter<C extends IpcContract> = {
  /**
   * 向渲染进程发送事件；底层是 `webContents.send`，只能主进程发起
   *
   * @param event 事件名（从契约 `rendererOn` 键推导）
   * @param payload 事件数据（从契约 `rendererOn` 值推导）
   * @param target 投递目标，不传则广播到所有窗口。传 `BrowserWindow` 发给它的
   * 主 webContents；需要精确到某个 webContents（如按 `event.sender` 记录的会话
   * 发起方）时直接传 `WebContents`
   */
  emit: <K extends string & keyof C['rendererOn']>(
    event: K,
    payload: C['rendererOn'][K],
    target?: Electron.BrowserWindow | Electron.WebContents,
  ) => void
}

/** `mainHandle` 通道 → renderer 侧类型（直接调用，返回 Promise） */
type InvokeMethods<C extends IpcContract> = {
  [K in keyof C['mainHandle']]: C['mainHandle'][K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>>
    : never
}

/** `rendererOn` 通道 → renderer 侧订阅方法 */
type EventSubscription<C extends IpcContract> = {
  /**
   * 订阅主进程推送的事件
   * @param event 事件名
   * @param callback 回调
   * @returns 取消订阅函数
   */
  on: <K extends string & keyof C['rendererOn']>(
    event: K,
    callback: (payload: C['rendererOn'][K]) => void,
  ) => () => void
}

/** `mainOn` 通道 → renderer 侧发送方法 */
type SendMethod<C extends IpcContract> = {
  /**
   * 向主进程单向发送，不等待、无返回值
   *
   * 拿不到处理结果和错误。需要结果或需要确认已处理时改用 `mainHandle` 通道
   *
   * @param name 消息名（从契约 `mainOn` 键推导）
   * @param args 消息参数（从契约 `mainOn` 签名推导）
   */
  send: <K extends string & keyof C['mainOn']>(
    name: K,
    ...args: C['mainOn'][K] extends (...args: infer A) => any ? A : never[]
  ) => void
}

/**
 * 渲染进程 IPC 客户端
 *
 * 合并三个通道的 renderer 侧能力：invoke 方法、事件订阅、单向发送
 */
export type IpcClient<C extends IpcContract> = InvokeMethods<C> & EventSubscription<C> & SendMethod<C>

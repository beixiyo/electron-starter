import { BrowserWindow, ipcMain } from 'electron'
import type { IpcContract, MainToRendererEmitter, ServiceImpl } from './contract'

let errorLogger: IpcServiceErrorLogger | null = null

export function setIpcServiceErrorLogger(logger: IpcServiceErrorLogger): void {
  errorLogger = logger
}

/**
 * 在主进程注册 IPC 服务
 *
 * - 契约 `mainHandle` → `ipcMain.handle`（renderer 调用并等待返回值）
 * - 契约 `mainOn` → `ipcMain.on`（renderer 单向发送，不回传结果）
 * - 返回类型安全的事件发射器（契约 `rendererOn`），用于向渲染进程推送事件
 *
 * @param namespace 服务命名空间，channel 格式为 `namespace:method`
 * @param impl 各通道的实现，字段名与契约一致；契约声明了哪个通道就必须实现哪个
 * @returns 事件发射器
 */
export function createIpcService<C extends IpcContract>(
  namespace: string,
  impl: ServiceImpl<C>,
): MainToRendererEmitter<C> {
  const { mainHandle, mainOn } = impl as {
    mainHandle?: Record<string, (...args: unknown[]) => unknown>
    mainOn?: Record<string, (...args: unknown[]) => unknown>
  }

  for (const [method, handler] of Object.entries(mainHandle ?? {})) {
    const channel = `${namespace}:${method}`

    ipcMain.handle(channel, async (...args: unknown[]) => {
      const startedAt = Date.now()
      try {
        return await (handler as (...a: unknown[]) => unknown)(...args)
      }
      catch (error) {
        logServiceError(error, {
          kind: 'mainHandle',
          namespace,
          method,
          channel,
          senderWebContentsId: senderIdOf(args[0]),
          durationMs: Date.now() - startedAt,
        })
        throw error
      }
    })
  }

  /**
   * `mainOn` 拿不到返回值，错误无处回传：这里必须自己兜住，
   * 否则 handler 抛错会静默丢失（异步抛错还会冒泡成 unhandledRejection）
   */
  for (const [method, handler] of Object.entries(mainOn ?? {})) {
    const channel = `${namespace}:${method}`

    ipcMain.on(channel, (...args: unknown[]) => {
      const startedAt = Date.now()
      const meta = {
        kind: 'mainOn',
        namespace,
        method,
        channel,
        senderWebContentsId: senderIdOf(args[0]),
        durationMs: 0,
      } satisfies IpcServiceErrorMeta

      try {
        const result = (handler as (...a: unknown[]) => unknown)(...args)
        /** handler 声明为同步，但实现可能是 async：补捕获它的 rejection */
        void Promise.resolve(result).catch((error) => {
          logServiceError(error, { ...meta, durationMs: Date.now() - startedAt })
        })
      }
      catch (error) {
        logServiceError(error, { ...meta, durationMs: Date.now() - startedAt })
      }
    })
  }

  return createMainToRendererEmitter<C>(namespace)
}

/**
 * 只造 main → renderer 的推送面，**不注册任何 handler**
 *
 * 给「契约里只有 `rendererOn`」的模块用：它们只往渲染进程发事件，收不到任何调用
 * 这类模块**不该进 `ipc/services/index.ts`**——那个 barrel 的职责是触发 `ipcMain.handle`
 * 注册，而这里一个 channel 都不注册，import 与否只影响模块何时求值
 *
 * 与 {@link createIpcService} 的关系：后者 = 注册 handler + 本函数。曾经没有这个入口，
 * 只想要发射器的模块只能写 `createIpcService(ns, {})`，一个空对象背后是「我不注册任何东西」
 * 这层意思，读的人只能去翻 `createIpcService` 才知道空实现意味着什么
 *
 * 两处若各建一个发射器，行为完全一致：`emit` 只按 namespace 拼 channel 名，
 * 不持有任何状态。但命名空间必须同源，漂开了 renderer 订阅的 channel 就对不上，且编译期无信号
 *
 * @param namespace 服务命名空间，channel 格式为 `namespace:event`
 */
export function createMainToRendererEmitter<C extends IpcContract>(
  namespace: string,
): MainToRendererEmitter<C> {
  return {
    emit(event, payload, target?) {
      const channel = `${namespace}:${String(event)}`

      if (target) {
        const wc = toWebContents(target)
        if (wc && !wc.isDestroyed()) wc.send(channel, payload)
        return
      }

      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(channel, payload)
      }
    },
  }
}

/**
 * 归一化投递目标为 WebContents
 *
 * `BrowserWindow` 已销毁时读 `.webContents` 会抛错，所以先判 `isDestroyed`
 */
function toWebContents(
  target: BrowserWindow | Electron.WebContents,
): Electron.WebContents | null {
  if (!(target instanceof BrowserWindow)) return target
  return target.isDestroyed()
    ? null
    : target.webContents
}

/** 从 IPC event 首参上取调用方 webContents id，取不到返回 undefined */
function senderIdOf(event: unknown): number | undefined {
  return (event as { sender?: { id?: number } } | undefined)?.sender?.id
}

function logServiceError(error: unknown, meta: IpcServiceErrorMeta): void {
  if (errorLogger) {
    errorLogger(error, meta)
    return
  }
  console.error(`[IPC] ${meta.channel} error`)
}

export type IpcServiceErrorMeta = {
  /** 出错的通道：`mainHandle` 会把错误抛回 renderer，`mainOn` 只能记录 */
  kind: 'mainHandle' | 'mainOn'
  namespace: string
  method: string
  channel: string
  senderWebContentsId?: number
  durationMs: number
}

export type IpcServiceErrorLogger = (error: unknown, meta: IpcServiceErrorMeta) => void

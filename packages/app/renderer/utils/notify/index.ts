import type { NotifyHandle, NotifyOptions } from './types'
import { isElectron } from '../env'
import { electronNotify, electronNotifySupported } from './electron'
import { requestWebPermission, webNotify, webNotifySupported } from './web'

/**
 * 跨平台发送一条通知（Web / Electron 统一入口）
 *
 * 运行时自动选择适配器：Electron 走原生 `Notification` + IPC，Web 走浏览器 `Notification`。
 * 通用配置写外层，平台特有配置写 `electron` / `web` 内层，详见 {@link NotifyOptions}
 *
 * @example
 * ```ts
 * const handle = notify({
 *   title: '新消息',
 *   body: '你有一条来自 Alice 的消息',
 *   tag: 'chat:alice',
 *   onClick: () => focusChat('alice'),
 * })
 * // 需要时主动关闭
 * handle.close()
 * ```
 */
export function notify(options: NotifyOptions): NotifyHandle {
  return isElectron()
    ? electronNotify(options)
    : webNotify(options)
}

/** 当前环境是否支持通知 */
export function isNotifySupported(): Promise<boolean> {
  return isElectron()
    ? electronNotifySupported()
    : Promise.resolve(webNotifySupported())
}

/**
 * 请求通知权限
 *
 * - Electron：主进程默认有权，直接返回 `true`（macOS 首次展示时仍可能弹系统授权框）
 * - Web：触发浏览器权限申请
 *
 * @returns 是否已获得授权
 */
export function requestNotifyPermission(): Promise<boolean> {
  return isElectron()
    ? Promise.resolve(true)
    : requestWebPermission()
}

export * from './types'

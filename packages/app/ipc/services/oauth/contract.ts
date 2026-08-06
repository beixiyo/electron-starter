import type { IpcContract } from '@ipc/core'
import type { OAuthCallbackDelivery, OAuthCallbackParams } from '@shared'

export type OAuthContract = IpcContract<{
  /** 登录页监听器就绪后注册，并读取等待中的 OAuth 回调 */
  registerReceiver: () => OAuthCallbackDelivery[]
  /** 登录页确认已消费回调后删除对应 pending */
  acknowledgeCallback: (id: string) => void
  /** 登录页卸载时注销，避免后续回调发给失效的监听器 */
  unregisterReceiver: () => void
}, {
  /** 旧事件契约仅保留类型兼容，新代码使用 callbackDelivery */
  callback: OAuthCallbackParams
  callbackDelivery: OAuthCallbackDelivery
}>

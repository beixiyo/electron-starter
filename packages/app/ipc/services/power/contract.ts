import type { IpcContract } from '@ipc/core'

/** 系统电源 / 锁屏事件类型。 */
export type PowerEventType = 'suspend' | 'resume' | 'lock-screen' | 'unlock-screen'

/** 系统电源 / 锁屏事件载荷。 */
export type PowerEventPayload = {
  type: PowerEventType
  at: string
}

/** 系统电源 IPC 契约。 */
export type PowerContract = IpcContract<{
  mainHandle: {
    /** 声明一段不应被系统休眠打断的渲染层活动。 */
    startActivity: () => string
    /** 结束一段由 startActivity 返回的活动声明。 */
    stopActivity: (requestId: string) => void
  }
  rendererOn: {
    event: PowerEventPayload
  }
}>

import type { IpcContract } from '@ipc/core'

/** macOS 用户小时制偏好，无法读取时返回 null 交给 renderer fallback */
export type HourCycle = 12 | 24

/** 系统显示偏好 IPC 契约 */
export type SystemPreferencesContract = IpcContract<{
  mainHandle: {
    /** 获取当前 macOS 用户实际生效的小时制；非 macOS 或 native helper 不可用时返回 null */
    getHourCycle: () => HourCycle | null
  }
  rendererOn: {
    /** macOS 用户小时制发生变化后，由主进程重读并推送最新值 */
    hourCycleChanged: HourCycle
  }
}>

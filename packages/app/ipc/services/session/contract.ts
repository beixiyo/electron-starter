import type { IpcContract } from '@ipc/core'

/** Chromium session 治理 IPC 契约。 */
export type SessionContract = IpcContract<{
  mainHandle: {
    /** 清空 defaultSession 的 HTTP 磁盘缓存，不触碰 cookies 或应用状态。 */
    clearHttpCache: () => void
  }
}>

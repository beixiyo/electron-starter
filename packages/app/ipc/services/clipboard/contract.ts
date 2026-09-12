import type { IpcContract } from '@ipc/core'

/** 剪贴板服务的 IPC 命名空间。 */
export const CLIPBOARD_NAMESPACE = 'clipboard'

/**
 * 系统剪贴板 IPC 契约
 *
 * 不可聚焦的浮窗无法稳定使用 renderer 的 navigator.clipboard，纯文本写入
 * 统一交给主进程的 Electron clipboard API
 */
export type ClipboardContract = IpcContract<{
  mainHandle: {
    /** 把纯文本写入系统剪贴板。 */
    writeText: (text: string) => void
  }
}>

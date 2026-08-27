import type { IpcContract } from '@ipc/core'
import type { GlobalToastPayload, ShowGlobalToastOptions } from '@shared'

/** 全局提示的上行与下行通道共用同一命名空间 */
export const GLOBAL_TOAST_NAMESPACE = 'global-toast'

/** renderer 实测的可见内容尺寸，不含窗口阴影留白 */
export type GlobalToastMeasurement = {
  /** 与当前内容同批的序号 */
  token: number
  width: number
  height: number
}

/** 全局提示窗口 IPC 契约 */
export type GlobalToastContract = IpcContract<{
  mainHandle: {
    /** 懒建窗口挂载后拉取当前内容，补齐首次推送竞态 */
    getCurrent: () => GlobalToastPayload | null
  }
  mainOn: {
    /** 任意 renderer 请求显示提示 */
    show: (options: ShowGlobalToastOptions) => void
    /** 主动收起当前提示 */
    dismiss: () => void
    /** 回传实测尺寸，主进程据此贴合窗口并重新定位 */
    measured: (size: GlobalToastMeasurement) => void
  }
  rendererOn: {
    /** 主进程推送当前内容；`null` 表示清空 */
    render: GlobalToastPayload | null
  }
}>

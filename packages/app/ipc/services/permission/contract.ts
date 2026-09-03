import type { IpcContract } from '@ipc/core'
import type { PermissionDragGuidePayload, PermissionKind, PermissionStatus } from '@shared'

export type PermissionContract = IpcContract<{
  mainHandle: {
    /** 查询权限状态 */
    get: (kind: PermissionKind) => PermissionStatus
    /** 主动申请权限：优先弹系统框；仍未授权时后续请求再打开隐私设置 */
    request: (kind: PermissionKind) => PermissionStatus
    /**
     * 打开 macOS 系统隐私设置对应面板
     *
     * accessibility / screen 会同时在面板旁展示拖拽引导卡片；返回值仍只表示「已受理」
     */
    openSettings: (kind: PermissionKind) => boolean
    /** 卡片挂载后补拉当前状态，堵住首帧推送早于订阅的窗口期 */
    getDragGuideState: () => PermissionDragGuidePayload | null
    /** 卡片发起原生 `.app` 拖拽；仅引导卡片窗口自身可调用 */
    dragGuideDrag: () => boolean
    /** 卡片自行关闭；仅引导卡片窗口自身可调用 */
    dragGuideDismiss: () => void
  }
  rendererOn: {
    /** 主进程要求主窗展示应用内权限说明，用户确认后再触发系统授权 */
    required: PermissionRequiredPayload
    /** 推给拖拽引导卡片窗口的渲染数据 */
    dragGuideState: PermissionDragGuidePayload
  }
}>

export type PermissionRequiredPayload = {
  kinds: PermissionKind[]
  reason: PermissionRequiredReason
}

export type PermissionRequiredReason = 'recording' | 'voice-ime' | 'screenshot-screen'

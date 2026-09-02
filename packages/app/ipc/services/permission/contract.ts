import type { IpcContract } from '@ipc/core'
import type { PermissionKind, PermissionStatus } from '@shared'

export type PermissionContract = IpcContract<{
  mainHandle: {
    /** 查询权限状态 */
    get: (kind: PermissionKind) => PermissionStatus
    /** 主动申请权限：优先弹系统框；仍未授权时后续请求再打开隐私设置 */
    request: (kind: PermissionKind) => PermissionStatus
    /** 打开 macOS 系统隐私设置对应面板 */
    openSettings: (kind: PermissionKind) => boolean
  }
  rendererOn: {
    /** 主进程要求主窗展示应用内权限说明，用户确认后再触发系统授权 */
    required: PermissionRequiredPayload
  }
}>

export type PermissionRequiredPayload = {
  kinds: PermissionKind[]
  reason: PermissionRequiredReason
}

export type PermissionRequiredReason = 'recording' | 'voice-ime' | 'screenshot-screen'

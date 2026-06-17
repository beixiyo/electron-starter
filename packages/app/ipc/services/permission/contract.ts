import type { IpcContract } from '@ipc/core'
import type { PermissionKind, PermissionStatus } from '@shared'

export type PermissionContract = IpcContract<{
  /** 查询权限状态 */
  get: (kind: PermissionKind) => PermissionStatus
  /** 主动申请权限：未授予时弹系统框 / 打开隐私设置（即使此前被拒绝也会引导） */
  request: (kind: PermissionKind) => PermissionStatus
  /** 打开 macOS 系统隐私设置对应面板 */
  openSettings: (kind: PermissionKind) => boolean
}, {
  /** 主进程要求主窗展示应用内权限说明，用户确认后再触发系统授权 */
  required: PermissionRequiredPayload
}>

export type PermissionRequiredPayload = {
  kinds: PermissionKind[]
  reason: PermissionRequiredReason
}

export type PermissionRequiredReason = 'recording' | 'voice-ime'

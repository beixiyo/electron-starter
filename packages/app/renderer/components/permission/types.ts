import type { PermissionKind, PermissionStatus } from '@shared'

/** 各权限的当前状态映射 */
export type PermissionStatusMap = Partial<Record<PermissionKind, PermissionStatus>>

/** 弹出权限窗时的可选文案覆盖 */
export type PermissionEnsureOptions = {
  /** 弹窗标题，默认用通用文案 */
  title?: string
  /** 弹窗副标题 */
  subtitle?: string
}

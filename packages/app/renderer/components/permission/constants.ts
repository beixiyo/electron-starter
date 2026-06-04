import type { PermissionKind, PermissionStatus } from '@shared'
import type { LucideIcon } from 'lucide-react'
import { Accessibility, Camera, Mic, MonitorSpeaker } from 'lucide-react'

type PermissionMeta = {
  /** 图标组件 */
  icon: LucideIcon
  /** 名称 i18n key */
  labelKey: string
  /** 开启按钮 i18n key */
  enableKey: string
  /** 补充说明 i18n key（可选） */
  hintKey?: string
}

/** 各权限的展示元数据（图标 + i18n key） */
export const PERMISSION_META: Record<PermissionKind, PermissionMeta> = {
  microphone: {
    icon: Mic,
    labelKey: 'permission.microphone.label',
    enableKey: 'permission.microphone.enable',
  },
  camera: {
    icon: Camera,
    labelKey: 'permission.camera.label',
    enableKey: 'permission.camera.enable',
  },
  screen: {
    icon: MonitorSpeaker,
    labelKey: 'permission.screen.label',
    enableKey: 'permission.screen.enable',
    hintKey: 'permission.screen.hint',
  },
  accessibility: {
    icon: Accessibility,
    labelKey: 'permission.accessibility.label',
    enableKey: 'permission.accessibility.enable',
    hintKey: 'permission.accessibility.hint',
  },
}

/**
 * 某权限是否已满足（可放行）
 * - screen：只要未被明确拒绝即可（not-determined 由系统在捕获时弹窗）
 * - 其它：必须已授予
 */
export function isPermissionSatisfied(kind: PermissionKind, status?: PermissionStatus): boolean {
  if (!status) {
    return false
  }
  if (kind === 'screen') {
    return status !== 'denied' && status !== 'restricted'
  }
  return status === 'granted'
}

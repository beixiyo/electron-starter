import type { PermissionKind, PermissionStatus } from '@shared'
import type { PermissionEnsureOptions, PermissionStatusMap } from './types'
import { useLatestCallback } from 'hooks'
import { useEffect, useState } from 'react'
import { isElectron } from '@/utils/env'
import { isPermissionSatisfied } from './constants'

/**
 * 统一权限网关
 *
 * - {@link ensure} 在使用某功能前校验所需权限，未满足则弹出统一权限窗
 * - 权限窗内逐项主动申请；首次优先走系统原生弹窗，仍未授权时后续请求再打开系统设置
 * - 适用于录制（麦克风 / 屏幕录制）、辅助功能（Fn 长按 / 划词）等场景
 */
export function usePermissions(): PermissionGate {
  const [statuses, setStatuses] = useState<PermissionStatusMap>({})
  const [open, setOpen] = useState(false)
  const [kinds, setKinds] = useState<PermissionKind[]>([])
  const [title, setTitle] = useState<string>()
  const [subtitle, setSubtitle] = useState<string>()

  const refresh = useLatestCallback(async (list: PermissionKind[]) => {
    if (!isElectron()) {
      const map = createGrantedPermissionMap(list)
      setStatuses(prev => ({ ...prev, ...map }))
      return map
    }

    const entries = await Promise.all(
      list.map(async kind => [kind, await $ipc.permission.get(kind)] as const),
    )
    const map = Object.fromEntries(entries) as PermissionStatusMap
    setStatuses(prev => ({ ...prev, ...map }))
    return map
  })

  const requestOne = useLatestCallback(async (kind: PermissionKind) => {
    if (!isElectron()) {
      const status: PermissionStatus = 'granted'
      setStatuses(prev => ({ ...prev, [kind]: status }))
      return status
    }

    const status = await $ipc.permission.request(kind)
    setStatuses(prev => ({ ...prev, [kind]: status }))
    return status
  })

  const openSettings = useLatestCallback((kind: PermissionKind) => {
    if (!isElectron())
      return Promise.resolve(false)

    return $ipc.permission.openSettings(kind)
  })

  /**
   * 校验所需权限
   * @returns 是否已满足全部权限（true 时可直接使用功能；false 时已弹出权限窗）
   */
  const ensure = useLatestCallback(async (list: PermissionKind[], opts?: PermissionEnsureOptions) => {
    const map = await refresh(list)
    const satisfied = list.every(kind => isPermissionSatisfied(kind, map[kind]))

    if (satisfied) {
      return true
    }

    setKinds(list)
    setTitle(opts?.title)
    setSubtitle(opts?.subtitle)
    setOpen(true)
    return false
  })

  const close = useLatestCallback(() => setOpen(false))

  /** 从系统设置返回时窗口重新聚焦，刷新权限状态 */
  useEffect(() => {
    if (!open) {
      return
    }
    const handleFocus = () => {
      refresh(kinds)
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [open, kinds, refresh])

  const canContinue = kinds.every(kind => isPermissionSatisfied(kind, statuses[kind]))

  return {
    statuses,
    open,
    kinds,
    title,
    subtitle,
    canContinue,
    ensure,
    requestOne,
    openSettings,
    refresh,
    close,
  }
}

function createGrantedPermissionMap(list: PermissionKind[]): PermissionStatusMap {
  return Object.fromEntries(list.map(kind => [kind, 'granted'])) as PermissionStatusMap
}

export type PermissionGate = {
  /** 各权限当前状态 */
  statuses: PermissionStatusMap
  /** 权限窗是否打开 */
  open: boolean
  /** 当前校验的权限列表 */
  kinds: PermissionKind[]
  /** 弹窗标题（覆盖用） */
  title?: string
  /** 弹窗副标题（覆盖用） */
  subtitle?: string
  /** 当前列表是否可继续 */
  canContinue: boolean
  /** 校验权限，未满足则弹窗，返回是否已满足 */
  ensure: (list: PermissionKind[], opts?: PermissionEnsureOptions) => Promise<boolean>
  /** 申请单个权限 */
  requestOne: (kind: PermissionKind) => Promise<PermissionStatus>
  /** 打开某权限的系统设置面板 */
  openSettings: (kind: PermissionKind) => Promise<boolean>
  /** 刷新指定权限状态 */
  refresh: (list: PermissionKind[]) => Promise<PermissionStatusMap>
  /** 关闭权限窗 */
  close: () => void
}

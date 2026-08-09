import type { PermissionKind, PermissionStatus } from '@shared'
import type { PermissionContract } from './contract'
import { createIpcService } from '@ipc/core'
import { getPermissionStatus, openPrivacySettings, requestPermission } from '@main/permissions'
import { requestShortcutRuntimeSync } from '@main/shortcuts/runtime-sync'

export const permissionService = createIpcService<PermissionContract>('permission', {
  mainHandle: {
    async get(_event, kind: PermissionKind) {
      const status = getPermissionStatus(kind)
      syncAccessibilityRuntime(kind, status)
      return status
    },

    async request(_event, kind: PermissionKind) {
      const status = await requestPermission(kind)
      syncAccessibilityRuntime(kind, status)
      return status
    },

    async openSettings(_event, kind: PermissionKind) {
      return openPrivacySettings(kind)
    },
  },
})

/**
 * 上次同步快捷键 runtime 时的 accessibility 状态；
 * 权限弹窗以 1s 轮询 permission.get，仅状态变化时才触发全量重注册，
 * 避免每 tick 重复 spawn 权限探测子进程 + uIOhook stop/start。
 * fn-listener 崩溃恢复的 resync 走 fn/core.ts onUnexpectedExit 直调，不经此门控
 */
let lastSyncedAccessibilityStatus: PermissionStatus | null = null

function syncAccessibilityRuntime(kind: PermissionKind, status: PermissionStatus): void {
  if (kind !== 'accessibility') {
    return
  }

  if (status === lastSyncedAccessibilityStatus) {
    return
  }

  lastSyncedAccessibilityStatus = status
  requestShortcutRuntimeSync()
}

import type { PermissionKind } from '@shared'
import type { PermissionContract } from './contract'
import { createIpcService } from '@ipc/core'
import { getPermissionStatus, openPrivacySettings, requestPermission } from '@main/permissions'
import { requestShortcutRuntimeSync } from '@main/shortcuts/runtime-sync'

export const permissionService = createIpcService<PermissionContract>('permission', {
  async get(_event, kind: PermissionKind) {
    const status = getPermissionStatus(kind)
    syncAccessibilityRuntime(kind)
    return status
  },

  async request(_event, kind: PermissionKind) {
    const status = await requestPermission(kind)
    syncAccessibilityRuntime(kind)
    return status
  },

  async openSettings(_event, kind: PermissionKind) {
    return openPrivacySettings(kind)
  },
})

function syncAccessibilityRuntime(kind: PermissionKind): void {
  if (kind !== 'accessibility') {
    return
  }

  requestShortcutRuntimeSync()
}

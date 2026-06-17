import type { PermissionKind } from '@shared'
import type { PermissionContract } from './contract'
import { createIpcService } from '@ipc/core'
import { isFnKeyListenerRunning, startFnKeyListener } from '@main/keyboard/fn/core'
import { getPermissionStatus, openPrivacySettings, requestPermission } from '@main/permissions'

export const permissionService = createIpcService<PermissionContract>('permission', {
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
})

function syncAccessibilityRuntime(kind: PermissionKind, status: string): void {
  if (kind !== 'accessibility' || status !== 'granted') {
    return
  }

  if (!isFnKeyListenerRunning()) {
    startFnKeyListener()
  }
}

import type { PermissionKind } from '@shared'
import type { PermissionContract } from './contract'
import { createIpcService } from '@ipc/core'
import { getPermissionStatus, openPrivacySettings, requestPermission } from '@main/permissions'

export const permissionService = createIpcService<PermissionContract>('permission', {
  async get(_event, kind: PermissionKind) {
    return getPermissionStatus(kind)
  },

  async request(_event, kind: PermissionKind) {
    return requestPermission(kind)
  },

  async openSettings(_event, kind: PermissionKind) {
    return openPrivacySettings(kind)
  },
})

import type { PermissionRequiredPayload, PermissionRequiredReason } from '@ipc/services/permission/contract'
import { permissionService } from '@ipc/services/permission/service'
import { WindowType } from '@shared'
import { getPermissionStatus } from './permissions'
import { windowManager } from './window-manager'

export function ensureMicrophonePermissionOrExplain(reason: PermissionRequiredReason): boolean {
  if (getPermissionStatus('microphone') === 'granted') {
    return true
  }

  showPermissionRequired({
    kinds: ['microphone'],
    reason,
  })

  return false
}

export function ensureScreenPermissionOrExplain(reason: PermissionRequiredReason): boolean {
  if (getPermissionStatus('screen') === 'granted') {
    return true
  }

  showPermissionRequired({
    kinds: ['screen'],
    reason,
  })

  return false
}

export function showPermissionRequired(payload: PermissionRequiredPayload): void {
  const mainWindow = windowManager.get(WindowType.MAIN)
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  windowManager.show(WindowType.MAIN)
  permissionService.emit('required', payload, mainWindow)
}

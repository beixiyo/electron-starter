import type { PermissionRequiredPayload, PermissionRequiredReason } from '@ipc/services/permission/contract'
import { permissionService } from '@ipc/services/permission/service'
import { WindowType } from '@shared'
import { ensureMainWindowReady } from './main-window-opener'
import { getPermissionStatus, requestPermission } from './permissions'
import { windowManager } from './window-manager'

/** 首次使用时请求系统麦克风权限；已经拒绝时转交应用内说明。 */
export async function ensureMicrophonePermissionOrExplain(reason: PermissionRequiredReason): Promise<boolean> {
  const currentStatus = getPermissionStatus('microphone')
  const status = currentStatus === 'not-determined'
    ? await requestPermission('microphone')
    : currentStatus
  if (status === 'granted') {
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
  void ensureMainWindowReady().then((mainWindow) => {
    if (!mainWindow)
      return

    windowManager.show(WindowType.MAIN)
    permissionService.emit('required', payload, mainWindow)
  })
}

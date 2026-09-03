import type { PermissionKind, PermissionStatus } from '@shared'
import type { PermissionContract } from './contract'
import { createIpcService } from '@ipc/core'
import { getPermissionStatus, presentPermissionSettings, requestPermission } from '@main/permissions'
import {
  dismissPermissionDragGuide,
  getPermissionDragGuideState,
  setPermissionDragGuideStateEmitter,
  startPermissionDragGuideDrag,
} from '@main/permissions/drag-guide'
import { requestShortcutRuntimeSync } from '@main/shortcuts/runtime-sync'
import { createMainDiagnosticLogger } from '@main/logging'

const log = createMainDiagnosticLogger('permission')

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
      /**
       * 可拖拽的面板改为展示拖拽引导卡片：只把用户丢进设置页，
       * 他要在一列应用里找到本应用再摸到右侧那个开关，这一步的流失正是本次要解决的
       */
      const opened = presentPermissionSettings(kind)
      log.info('settings.opened', 'system privacy settings open requested', { kind, opened })
      return opened
    },

    async getDragGuideState() {
      return getPermissionDragGuideState()
    },

    async dragGuideDrag(event) {
      return startPermissionDragGuideDrag(event)
    },

    async dragGuideDismiss(event) {
      dismissPermissionDragGuide(event)
    },
  },
})

/**
 * 把「怎么推到渲染层」补齐给控制器
 *
 * 控制器只决定推送时机，通道由这里提供；两边不互相 import，避免
 * service → @main/permissions → drag-guide → service 的循环
 */
setPermissionDragGuideStateEmitter((payload, window) => {
  permissionService.emit('dragGuideState', payload, window)
})

/**
 * 上次同步快捷键 runtime 时的 accessibility 状态；
 * 权限弹窗以 1s 轮询 permission.get，仅状态变化时才触发全量重注册，
 * 避免每 tick 重复 spawn 权限探测子进程 + uIOhook stop/start
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

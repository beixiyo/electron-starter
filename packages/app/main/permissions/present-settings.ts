/**
 * 「需要用户去系统设置里授权」这一动作的统一出口
 *
 * 拆出来是为了让策略只有一处：可拖拽的面板走引导卡片，其余仍是老的打开面板
 * `openPrivacySettings` 保持成一个诚实的原语——名字说打开面板就只打开面板，
 * 不在里面偷偷弹一个浮窗
 */

import { createMainDiagnosticLogger } from '@main/logging'
import type { PermissionKind } from '@shared'
import { isPermissionDragKind } from '@shared'
import { startPermissionDragGuide } from './drag-guide'
import { openPrivacySettings } from './privacy-urls'

const log = createMainDiagnosticLogger('permission')

/**
 * 引导用户完成系统授权
 *
 * 对 accessibility / screen 展示拖拽引导卡片，其余权限维持原行为
 * **刻意不 await**：定位系统设置窗口要等它停稳（最长 2.5s），
 * 而调用方（`requestPermission` / `openSettings`）的既有语义是「立刻返回当前状态」，
 * 由渲染层的轮询接管后续。等待会把这条链路整体拖慢 2.5s
 *
 * @returns 是否已受理（与 `openPrivacySettings` 的返回语义保持一致）
 */
export function presentPermissionSettings(kind: PermissionKind): boolean {
  if (process.platform !== 'darwin') {
    return false
  }

  if (!isPermissionDragKind(kind)) {
    return openPrivacySettings(kind)
  }

  void startPermissionDragGuide(kind)
    .then((result) => {
      /**
       * 只有 `already-granted` 需要补开面板：它说明被拖的 bundle 自己已授权，引导没开任何面板，
       * 但调用方是因为**别的**缺口才走到这里的（accessibility 还要求 fn-listener helper
       * 同样被信任），不补开的话用户点了「去授权」屏幕上什么都不会发生
       *
       * `superseded` / `unavailable` 时面板已由引导自己打开，再开一次会重新激活系统设置，
       * 打断另一次正在等它停稳的会话
       */
      if (result === 'already-granted') {
        openPrivacySettings(kind)
      }
    })
    .catch((error: unknown) => {
      log.warn('present.drag-guide-failed', 'drag guide failed; falling back to opening the pane', {
        kind,
        error: String(error),
      })
      openPrivacySettings(kind)
    })

  return true
}

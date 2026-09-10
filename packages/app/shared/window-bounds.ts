/**
 * 窗口几何的「可见内容」口径
 *
 * 透明无边框窗四周会留一圈纯透明的阴影带（CSS 投影只能画在窗口边界内），
 * 窗口边因此不等于用户看得见的那条边。位置预设与边界收敛都要按可见内容计量，
 * 换算集中在这里，避免各处各按各的理解扣一遍 inset
 */

import { EMPTY_INSETS } from './window-config/metrics'
import type { WindowBounds, WindowInsets } from './window-config/types'

/**
 * 把窗口收敛进目标屏幕的可用区域内
 *
 * 只保证「可见内容」落在工作区里：`insets` 声明的那圈纯透明留白允许越过屏幕边缘，
 * 否则底部浮层为压低可见内容而下探的留白会被判成越界并被拽回来
 *
 * 窗口大于可用区域时优先保留左上角，避免算出反向边界
 */
export function clampWindowBounds(
  bounds: WindowBounds,
  workArea: WindowBounds,
  insets: Partial<WindowInsets> = EMPTY_INSETS,
): WindowBounds {
  const resolvedInsets = { ...EMPTY_INSETS, ...insets }
  const minX = workArea.x - resolvedInsets.left
  const minY = workArea.y - resolvedInsets.top
  const maxX = Math.max(
    minX,
    workArea.x + workArea.width - bounds.width + resolvedInsets.right,
  )
  const maxY = Math.max(
    minY,
    workArea.y + workArea.height - bounds.height + resolvedInsets.bottom,
  )

  return {
    ...bounds,
    x: clamp(bounds.x, minX, maxX),
    y: clamp(bounds.y, minY, maxY),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

import type { ResizeHandle, SelectionRect } from '../types'
import { MIN_SELECTION_SIZE } from '../constants'
import { HANDLE_EDGES } from './handles'

/**
 * 由两个对角点构造矩形
 *
 * 用 min/abs 归一化，支持向任意方向反拖（拉新选区必须支持）
 */
export function rectFromPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): SelectionRect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}

export function isPointInRect(x: number, y: number, rect: SelectionRect) {
  return x >= rect.x
    && x <= rect.x + rect.width
    && y >= rect.y
    && y <= rect.y + rect.height
}

export function isValidSelection(rect: SelectionRect | null): rect is SelectionRect {
  return !!rect
    && rect.width >= MIN_SELECTION_SIZE
    && rect.height >= MIN_SELECTION_SIZE
}

/**
 * 缩放选区：按把手驱动的边施加位移，其余边锚定
 *
 * 刻意不支持翻转（拖过对边不会把选区翻到另一侧），而是把移动边卡在距锚定边
 * MIN_SELECTION_SIZE 处 —— 翻转会让把手身份在拖拽中途突变，被驱动的边随之改变；
 * 拉新选区那条路径走 rectFromPoints，翻转照常支持
 */
export function resizeRect(
  startRect: SelectionRect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
): SelectionRect {
  const edges = HANDLE_EDGES[handle]

  let left = startRect.x
  let top = startRect.y
  let right = startRect.x + startRect.width
  let bottom = startRect.y + startRect.height

  if (edges.left)
    left = Math.min(left + dx, right - MIN_SELECTION_SIZE)
  if (edges.right)
    right = Math.max(right + dx, left + MIN_SELECTION_SIZE)
  if (edges.top)
    top = Math.min(top + dy, bottom - MIN_SELECTION_SIZE)
  if (edges.bottom)
    bottom = Math.max(bottom + dy, top + MIN_SELECTION_SIZE)

  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * 平移后把选区推回视口内，尺寸保持不变
 *
 * 与 clipRectToViewport 的区别：平移不该让选区变小，只该让它停在边界
 */
export function clampRectInside(
  rect: SelectionRect,
  viewportWidth: number,
  viewportHeight: number,
): SelectionRect {
  return {
    ...rect,
    x: Math.min(Math.max(0, rect.x), Math.max(0, viewportWidth - rect.width)),
    y: Math.min(Math.max(0, rect.y), Math.max(0, viewportHeight - rect.height)),
  }
}

/** 把选区裁进视口，允许尺寸缩小（缩放与拉新选区用） */
export function clipRectToViewport(
  rect: SelectionRect,
  viewportWidth: number,
  viewportHeight: number,
): SelectionRect {
  const left = Math.max(0, rect.x)
  const top = Math.max(0, rect.y)
  const right = Math.min(viewportWidth, rect.x + rect.width)
  const bottom = Math.min(viewportHeight, rect.y + rect.height)

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

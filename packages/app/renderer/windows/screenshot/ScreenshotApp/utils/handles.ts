import type { HandleEdges, ResizeHandle, SelectionRect } from '../types'
import { HANDLE_HIT_RADIUS } from '../constants'

/** 渲染顺序固定，保证 key 稳定 */
export const RESIZE_HANDLES: readonly ResizeHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
]

/**
 * 把手 → 它驱动的边
 *
 * 角把手驱动两条边，边把手只驱动一条，未驱动的边在缩放中锚定不动
 */
export const HANDLE_EDGES: Record<ResizeHandle, HandleEdges> = {
  nw: { top: true, right: false, bottom: false, left: true },
  n: { top: true, right: false, bottom: false, left: false },
  ne: { top: true, right: true, bottom: false, left: false },
  e: { top: false, right: true, bottom: false, left: false },
  se: { top: false, right: true, bottom: true, left: false },
  s: { top: false, right: false, bottom: true, left: false },
  sw: { top: false, right: false, bottom: true, left: true },
  w: { top: false, right: false, bottom: false, left: true },
}

/** 把手 → CSS cursor，对角把手共用同一根双向箭头 */
export const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
}

/** 把手中心点（视口坐标） */
export function getHandleCenter(rect: SelectionRect, handle: ResizeHandle) {
  const { top, right, bottom, left } = HANDLE_EDGES[handle]

  const x = left
    ? rect.x
    : right
      ? rect.x + rect.width
      : rect.x + rect.width / 2

  const y = top
    ? rect.y
    : bottom
      ? rect.y + rect.height
      : rect.y + rect.height / 2

  return { x, y }
}

/**
 * 命中检测：指针落在哪个把手上
 *
 * 按 RESIZE_HANDLES 顺序取首个命中，小选区下角把手与边把手判定区重叠时，
 * 角把手优先（它排在前面）
 */
export function hitTestHandle(
  x: number,
  y: number,
  rect: SelectionRect,
): ResizeHandle | null {
  for (const handle of RESIZE_HANDLES) {
    const center = getHandleCenter(rect, handle)
    const hit = Math.abs(x - center.x) <= HANDLE_HIT_RADIUS
      && Math.abs(y - center.y) <= HANDLE_HIT_RADIUS

    if (hit)
      return handle
  }

  return null
}

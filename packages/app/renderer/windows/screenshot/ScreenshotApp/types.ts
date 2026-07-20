import type { ScreenshotBounds } from '@shared'

/**
 * 选区矩形，坐标系为 CSS 像素（DIP），与 overlay 视口同系
 *
 * 主进程裁剪时会乘以 scaleFactor 转成物理像素，渲染层不做该换算
 */
export type SelectionRect = ScreenshotBounds

/** 8 向缩放把手，命名取罗盘方位 */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** 把手驱动的边：决定拖动该把手时哪几条边跟随移动，其余边锚定不动 */
export type HandleEdges = {
  top: boolean
  right: boolean
  bottom: boolean
  left: boolean
}

/**
 * 选区交互状态机
 *
 * 单一状态源，避免「是否在拖拽」「拖的是哪个把手」散落成多个 boolean 后互相打架
 *
 * - `idle`     无进行中的操作（可能已有确认的选区）
 * - `drawing`  拉新选区，origin 为按下点，全程不变，与当前指针构成对角
 * - `moving`   整体平移，offset 为按下点相对选区左上角的偏移，保证指针不跳
 * - `resizing` 缩放，startRect 为按下瞬间的选区快照，配合指针位移算新边
 */
export type InteractionState
  = | { type: 'idle' }
    | { type: 'drawing', originX: number, originY: number }
    | { type: 'moving', offsetX: number, offsetY: number }
    | {
      type: 'resizing'
      handle: ResizeHandle
      startRect: SelectionRect
      startX: number
      startY: number
    }

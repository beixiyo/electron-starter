import type { WindowType } from '@shared'
import type { ResizeDir, UseWindowResizeOptions } from './useWindowResize'
import { memo } from 'react'
import { cn } from 'utils'
import { useWindowResize } from './useWindowResize'

/**
 * 窗口四角 + 四边缩放手柄（透明覆盖层）
 *
 * 覆盖到可见内容框（由 `inset` 对齐阴影留白），手柄本身透明、仅提供抓取热区与方向光标
 * 任意透明无边框窗口直接挂载即可获得拖拽缩放能力，配合主进程 `persistBounds` 即持久化
 */
export const ResizeHandles = memo<ResizeHandlesProps>((props) => {
  const {
    windowType,
    inset = 0,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
    className,
  } = props

  const { startResize, handleMove, handleUp } = useWindowResize(windowType, {
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
  })

  return (
    <div
      className={ cn('absolute z-50 pointer-events-none', className) }
      style={ { top: inset, left: inset, right: inset, bottom: inset } }
    >
      { GRIPS.map(grip => (
        <div
          key={ grip.dir }
          className={ cn(
            'absolute pointer-events-auto touch-none',
            '[-webkit-app-region:no-drag]',
            grip.className,
          ) }
          onPointerDown={ e => startResize(grip.dir, e) }
          onPointerMove={ handleMove }
          onPointerUp={ handleUp }
        />
      )) }
    </div>
  )
})

ResizeHandles.displayName = 'ResizeHandles'

/** 八向手柄：角块 16×16 居中压在角点，边条夹在两角之间 */
const GRIPS: Array<{ dir: ResizeDir, className: string }> = [
  { dir: 'nw', className: 'top-0 left-0 size-4 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize' },
  { dir: 'ne', className: 'top-0 right-0 size-4 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize' },
  { dir: 'sw', className: 'bottom-0 left-0 size-4 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize' },
  { dir: 'se', className: 'bottom-0 right-0 size-4 translate-x-1/2 translate-y-1/2 cursor-nwse-resize' },

  { dir: 'n', className: 'top-0 left-4 right-4 h-2 -translate-y-1/2 cursor-ns-resize' },
  { dir: 's', className: 'bottom-0 left-4 right-4 h-2 translate-y-1/2 cursor-ns-resize' },
  { dir: 'w', className: 'left-0 top-4 bottom-4 w-2 -translate-x-1/2 cursor-ew-resize' },
  { dir: 'e', className: 'right-0 top-4 bottom-4 w-2 translate-x-1/2 cursor-ew-resize' },
]

export type ResizeHandlesProps = {
  /** 目标窗口类型 */
  windowType: WindowType
  /**
   * 可见内容相对窗口的留白（透明阴影窗用 SHADOW_INSET 对齐可见边角）
   *
   * @default 0
   */
  inset?: number
  className?: string
}
& UseWindowResizeOptions

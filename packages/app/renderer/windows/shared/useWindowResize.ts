import type { WindowType } from '@shared'
import { rafThrottle } from '@jl-org/tool'
import { useLatestCallback } from 'hooks'
import { useMemo, useRef } from 'react'

/**
 * 自绘手柄拖拽缩放当前窗口（透明无边框窗的可靠方案）
 *
 * 流程：手柄 pointerdown → `setPointerCapture` 锁定指针（即便移出手柄也持续收事件）
 * → 异步取一次窗口起始 bounds → pointermove 用屏幕坐标增量算新 bounds，
 * 经 `rafThrottle` 逐帧节流调 `$ipc.window.setBounds` → pointerup 收尾。
 *
 * 八个方向用方位字符判定：含 `e/w` 改宽、含 `s/n` 改高，含 `w/n` 时同步移动原点，
 * 触达 min/max 时锁住被拖动边、保持对侧锚点不动。
 */
export function useWindowResize(
  windowType: WindowType,
  options: UseWindowResizeOptions = {},
): UseWindowResizeReturn {
  const {
    minWidth = 0,
    minHeight = 0,
    maxWidth = Infinity,
    maxHeight = Infinity,
  } = options

  const dragRef = useRef<DragState | null>(null)

  /** 逐帧节流：每帧最多一次 setBounds，避免高频 IPC 卡顿；pointerup 后最后一帧仍会落地 */
  const applyBounds = useMemo(
    () => rafThrottle((bounds: WindowRect) => {
      $ipc.window.setBounds(windowType, bounds, false)
    }),
    [windowType],
  )

  const handleMove = useLatestCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || !drag.start)
      return

    const dx = e.screenX - drag.startCursorX
    const dy = e.screenY - drag.startCursorY
    const { dir, start } = drag

    let { x, y, width, height } = start

    if (dir.includes('e'))
      width = start.width + dx

    if (dir.includes('w')) {
      width = start.width - dx
      x = start.x + dx
    }

    if (dir.includes('s'))
      height = start.height + dy

    if (dir.includes('n')) {
      height = start.height - dy
      y = start.y + dy
    }

    /** 触达尺寸边界时，锁住被拖动边、保持对侧锚点不动 */
    if (width < minWidth) {
      if (dir.includes('w'))
        x -= minWidth - width
      width = minWidth
    }
    if (width > maxWidth) {
      if (dir.includes('w'))
        x += width - maxWidth
      width = maxWidth
    }
    if (height < minHeight) {
      if (dir.includes('n'))
        y -= minHeight - height
      height = minHeight
    }
    if (height > maxHeight) {
      if (dir.includes('n'))
        y += height - maxHeight
      height = maxHeight
    }

    applyBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    })
  })

  const handleUp = useLatestCallback((e: React.PointerEvent) => {
    if (!dragRef.current)
      return

    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    catch {
      /** 指针已释放，忽略 */
    }

    dragRef.current = null
  })

  const startResize = useLatestCallback((dir: ResizeDir, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()

    /** 同步锁定指针 + 记录起点（await 后 React 会清空 currentTarget，故先取值） */
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    catch {
      /** 不支持指针捕获时降级为普通拖拽 */
    }

    dragRef.current = {
      dir,
      startCursorX: e.screenX,
      startCursorY: e.screenY,
      start: null,
    }

    /** 异步取窗口起始 bounds（pointerdown 到首次有效 move 间有人手延迟，足够回填） */
    $ipc.window.getBounds(windowType).then(({ bounds }) => {
      const drag = dragRef.current
      if (drag && bounds)
        drag.start = bounds
    })
  })

  return { startResize, handleMove, handleUp }
}

/** 八方向：四角 + 四边 */
export type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export interface UseWindowResizeOptions {
  /** @default 0 */
  minWidth?: number
  /** @default 0 */
  minHeight?: number
  /** @default Infinity */
  maxWidth?: number
  /** @default Infinity */
  maxHeight?: number
}

export interface UseWindowResizeReturn {
  /** 手柄 onPointerDown：传入方向开始拖拽 */
  startResize: (dir: ResizeDir, e: React.PointerEvent) => void
  /** 手柄 onPointerMove */
  handleMove: (e: React.PointerEvent) => void
  /** 手柄 onPointerUp */
  handleUp: (e: React.PointerEvent) => void
}

interface WindowRect {
  x: number
  y: number
  width: number
  height: number
}

interface DragState {
  dir: ResizeDir
  startCursorX: number
  startCursorY: number
  /** 起始 bounds，异步取得前为 null */
  start: WindowRect | null
}

import type { WindowBounds, WindowType } from '@shared'
import type { PointerEvent } from 'react'

import { useLatestCallback } from 'hooks'
import { useRef } from 'react'

/**
 * 渲染层手写窗口拖动
 *
 * 透明点击穿透窗口不能稳定依赖 `-webkit-app-region: drag`，否则拖拽区会吞掉 DOM 交互
 */
export function useWindowDrag(type: WindowType): WindowDragHandlers {
  const dragRef = useRef<DragState | null>(null)

  const handlePointerDown = useLatestCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0)
      return

    /** 先退出点击穿透再判断是否可拖拽，保证 no-drag 控件（如关闭按钮）的这次点击也稳定命中 */
    void $ipc.window.setIgnoreMouseEvents(type, false)

    if (isNoDragTarget(event.target))
      return

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)

    const startScreenX = event.screenX
    const startScreenY = event.screenY
    dragRef.current = {
      pointerId: event.pointerId,
      startScreenX,
      startScreenY,
      startBounds: null,
    }

    void $ipc.window.getBounds(type).then(({ bounds }) => {
      if (!bounds)
        return

      const drag = dragRef.current
      if (drag?.pointerId === event.pointerId)
        drag.startBounds = bounds
    })
  })

  const handlePointerMove = useLatestCallback((event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !drag.startBounds)
      return

    event.preventDefault()
    const dx = event.screenX - drag.startScreenX
    const dy = event.screenY - drag.startScreenY

    void $ipc.window.setBounds(type, {
      x: Math.round(drag.startBounds.x + dx),
      y: Math.round(drag.startBounds.y + dy),
    })
  })

  const handlePointerEnd = useLatestCallback((event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId)
      return

    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  })

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerEnd,
    onPointerCancel: handlePointerEnd,
    onLostPointerCapture: handlePointerEnd,
  }
}

function isNoDragTarget(target: EventTarget): boolean {
  /** 用 Element 而非 HTMLElement：点击 CloseBtn 等控件时 target 常是内部 SVG 图标 */
  return target instanceof Element && target.closest('[data-no-window-drag="true"]') !== null
}

type WindowDragHandlers = {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void
  onPointerMove: (event: PointerEvent<HTMLElement>) => void
  onPointerUp: (event: PointerEvent<HTMLElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void
  onLostPointerCapture: (event: PointerEvent<HTMLElement>) => void
}

type DragState = {
  pointerId: number
  startScreenX: number
  startScreenY: number
  startBounds: WindowBounds | null
}

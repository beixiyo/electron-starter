import type { WindowBounds, WindowType } from '@shared'
import type { PointerEvent } from 'react'

import { useLatestCallback } from 'hooks'
import { useRef } from 'react'
import { WINDOW_DATA_ATTR } from './dataAttributes'

/**
 * 渲染层手写窗口拖动
 *
 * 透明点击穿透窗口不能稳定依赖 `-webkit-app-region: drag`，否则拖拽区会吞掉 DOM 交互
 */
export function useWindowDrag(type: WindowType, options: WindowDragOptions = {}): WindowDragHandlers {
  const { onDragStart, resolveBounds } = options
  const dragRef = useRef<DragState | null>(null)

  const handlePointerDown = useLatestCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return

    /** 先退出点击穿透再判断是否可拖拽，保证 no-drag 控件（如关闭按钮）的这次点击也稳定命中 */
    void $ipc.window.setIgnoreMouseEvents(type, false)

    if (isNoDragTarget(event.target)) return

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    onDragStart?.()

    const startScreenX = event.screenX
    const startScreenY = event.screenY
    const drag: DragState = {
      pointerId: event.pointerId,
      startScreenX,
      startScreenY,
      startBounds: null,
    }
    dragRef.current = drag

    void $ipc.window.getBounds(type).then(({ bounds }) => {
      if (!bounds) return

      /** 鼠标会跨轮次复用 pointerId；只有当前拖动对象可以接收异步起点。 */
      if (dragRef.current === drag) drag.startBounds = bounds
    })
  })

  const handlePointerMove = useLatestCallback((event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !drag.startBounds) return

    event.preventDefault()
    const dx = event.screenX - drag.startScreenX
    const dy = event.screenY - drag.startScreenY

    const intended = {
      x: Math.round(drag.startBounds.x + dx),
      y: Math.round(drag.startBounds.y + dy),
    }
    const next = resolveBounds?.(intended) ?? intended

    void $ipc.window.setBounds(type, {
      x: Math.round(next.x),
      y: Math.round(next.y),
    })
  })

  const handlePointerEnd = useLatestCallback((event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

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
  if (!(target instanceof Element)) return false

  return target.closest([
    '[data-no-window-drag="true"]',
    `[${WINDOW_DATA_ATTR.noDrag}="true"]`,
    'button',
    'input',
    'textarea',
    'select',
    'a',
    '[role="button"]',
    '[contenteditable="true"]',
  ].join(',')) !== null
}

/** 拖动行为的可选扩展点，未传时保留窗口刚性平移行为 */
export type WindowDragOptions = {
  /** 每次通过拖动判定后按下时调用一次，供调用方快照拖动起点状态 */
  onDragStart?: () => void
  /** 改写本次刚性平移算出的窗口目标位置 */
  resolveBounds?: (intended: { x: number, y: number }) => { x: number, y: number }
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

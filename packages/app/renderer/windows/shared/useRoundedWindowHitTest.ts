import type { WindowType } from '@shared'
import { useEffect, useRef } from 'react'

const RESIZE_CORNER_SIZE = 16
const RESIZE_EDGE_SIZE = 8

/**
 * 按圆角实体区域动态切换窗口点击穿透
 *
 * 鼠标位于实体区域时窗口正常接收事件；位于透明阴影、圆角裁切外、实体间隙时穿透到后方应用
 */
export function useRoundedWindowHitTest(
  type: WindowType,
  regions: RoundedWindowHitTestRegionInput,
): void {
  const ignoredRef = useRef<boolean | null>(null)
  const regionsRef = useRef(regions)
  regionsRef.current = regions

  useEffect(() => {
    const setIgnored = (ignored: boolean): void => {
      if (ignoredRef.current === ignored)
        return

      ignoredRef.current = ignored
      void $ipc.window.setIgnoreMouseEvents(
        type,
        ignored,
        ignored
          ? { forward: true }
          : undefined,
      )
    }

    const getRegions = (): RoundedWindowHitTestRegion[] => {
      const current = regionsRef.current

      return typeof current === 'function'
        ? current()
        : current
    }

    const handleMove = (event: MouseEvent): void => {
      const inside = getRegions().some(region => isInsideRoundedRegion(event.clientX, event.clientY, region))
      setIgnored(!inside)
    }

    const handleLeave = (): void => {
      setIgnored(true)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseleave', handleLeave)
    setIgnored(false)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseleave', handleLeave)
      void $ipc.window.setIgnoreMouseEvents(type, false)
    }
  }, [type])
}

export function getInsetWindowHitTestRegion(
  inset: number,
  radius: number,
  size: WindowHitTestSize = getCurrentWindowSize(),
): RoundedWindowHitTestRegion {
  return {
    x: inset,
    y: inset,
    width: Math.max(0, size.width - inset * 2),
    height: Math.max(0, size.height - inset * 2),
    radius,
  }
}

export function getResizeHandleHitTestRegions(
  inset: number,
  size: WindowHitTestSize = getCurrentWindowSize(),
): RoundedWindowHitTestRegion[] {
  const contentWidth = Math.max(0, size.width - inset * 2)
  const contentHeight = Math.max(0, size.height - inset * 2)
  const halfCorner = RESIZE_CORNER_SIZE / 2
  const halfEdge = RESIZE_EDGE_SIZE / 2
  const right = inset + contentWidth
  const bottom = inset + contentHeight

  return [
    rectRegion(inset - halfCorner, inset - halfCorner, RESIZE_CORNER_SIZE, RESIZE_CORNER_SIZE),
    rectRegion(right - halfCorner, inset - halfCorner, RESIZE_CORNER_SIZE, RESIZE_CORNER_SIZE),
    rectRegion(inset - halfCorner, bottom - halfCorner, RESIZE_CORNER_SIZE, RESIZE_CORNER_SIZE),
    rectRegion(right - halfCorner, bottom - halfCorner, RESIZE_CORNER_SIZE, RESIZE_CORNER_SIZE),

    rectRegion(inset + RESIZE_CORNER_SIZE, inset - halfEdge, Math.max(0, contentWidth - RESIZE_CORNER_SIZE * 2), RESIZE_EDGE_SIZE),
    rectRegion(inset + RESIZE_CORNER_SIZE, bottom - halfEdge, Math.max(0, contentWidth - RESIZE_CORNER_SIZE * 2), RESIZE_EDGE_SIZE),
    rectRegion(inset - halfEdge, inset + RESIZE_CORNER_SIZE, RESIZE_EDGE_SIZE, Math.max(0, contentHeight - RESIZE_CORNER_SIZE * 2)),
    rectRegion(right - halfEdge, inset + RESIZE_CORNER_SIZE, RESIZE_EDGE_SIZE, Math.max(0, contentHeight - RESIZE_CORNER_SIZE * 2)),
  ]
}

function getCurrentWindowSize(): WindowHitTestSize {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  }
}

function rectRegion(
  x: number,
  y: number,
  width: number,
  height: number,
): RoundedWindowHitTestRegion {
  return { x, y, width, height, radius: 0 }
}

function isInsideRoundedRegion(
  x: number,
  y: number,
  region: RoundedWindowHitTestRegion,
): boolean {
  const left = region.x
  const top = region.y
  const right = region.x + region.width
  const bottom = region.y + region.height

  if (x < left || x > right || y < top || y > bottom)
    return false

  const safeRadius = Math.min(region.radius, region.width / 2, region.height / 2)
  const closestX = Math.min(Math.max(x, left + safeRadius), right - safeRadius)
  const closestY = Math.min(Math.max(y, top + safeRadius), bottom - safeRadius)
  const dx = x - closestX
  const dy = y - closestY

  return dx * dx + dy * dy <= safeRadius * safeRadius
}

export type RoundedWindowHitTestRegionInput
  = | RoundedWindowHitTestRegion[]
    | (() => RoundedWindowHitTestRegion[])

export type RoundedWindowHitTestRegion = {
  x: number
  y: number
  width: number
  height: number
  radius: number
}

type WindowHitTestSize = {
  width: number
  height: number
}

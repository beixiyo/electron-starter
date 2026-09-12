import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'

/**
 * 在页面顶部居中的矩形区域旁听连续点击，并在达到次数后触发回调
 * 事件只用于计数，不阻止页面原本的点击行为
 */
export function useMultiTapTrigger(options: UseMultiTapTriggerOptions): number {
  const {
    width,
    height,
    count,
    resetMs = 800,
    onTrigger,
  } = options
  const [taps, setTaps] = useState(0)
  const tapsRef = useRef(0)
  const lastTapAtRef = useRef(0)
  const handleTrigger = useLatestCallback(onTrigger)

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const centerX = window.innerWidth / 2
      const inside = event.clientY >= 0
        && event.clientY <= height
        && event.clientX >= centerX - width / 2
        && event.clientX <= centerX + width / 2

      if (!inside) {
        tapsRef.current = 0
        setTaps(0)
        return
      }

      const now = Date.now()
      tapsRef.current = now - lastTapAtRef.current > resetMs
        ? 1
        : tapsRef.current + 1
      lastTapAtRef.current = now

      if (tapsRef.current >= count) {
        tapsRef.current = 0
        setTaps(0)
        handleTrigger()
        return
      }

      setTaps(tapsRef.current)
    }

    document.addEventListener('pointerdown', handlePointerDown, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, { capture: true })
    }
  }, [count, handleTrigger, height, resetMs, width])

  return taps
}

export type UseMultiTapTriggerOptions = {
  /** 热区宽度（px），水平居中于视口。 */
  width: number
  /** 热区高度（px），从页面顶部开始计算。 */
  height: number
  /** 触发回调所需的连续点击次数。 */
  count: number
  /** 相邻点击的最大间隔（ms）。 */
  resetMs?: number
  onTrigger: () => void
}

import { useEffect, useRef, useState } from 'react'

/**
 * 通过全局 pointermove + 矩形碰撞检测 hover 状态，
 * 绕过 Electron `-webkit-app-region: drag` 吞事件的问题
 */
export function useBarHover<T extends HTMLElement>(margin = 8) {
  const ref = useRef<T>(null)
  const [isHovered, setIsHovered] = useState(false)
  const prevRef = useRef(false)

  useEffect(() => {
    let rafId: number

    const onPointerMove = (e: PointerEvent) => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const el = ref.current
        if (!el)
          return

        const { left, right, top, bottom } = el.getBoundingClientRect()
        const inside
          = e.clientX >= left - margin
            && e.clientX <= right + margin
            && e.clientY >= top - margin
            && e.clientY <= bottom + margin

        if (inside !== prevRef.current) {
          prevRef.current = inside
          setIsHovered(inside)
        }
      })
    }

    document.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => {
      document.removeEventListener('pointermove', onPointerMove)
      cancelAnimationFrame(rafId)
    }
  }, [margin])

  return { ref, isHovered }
}

import { describe, expect, it } from 'vitest'
import { resolveFloatingArrowBox, resolveFloatingArrowGeometry } from '../geometry'

describe('FloatingArrow geometry', () => {
  it('显式使用旧半径参数时保留圆弧轮廓和旧默认宽度', () => {
    const geometry = resolveFloatingArrowGeometry({
      tipRadius: 2,
      baseRadius: 2,
    })

    expect(geometry.width).toBe(22)
    expect(geometry.path).toContain('A2,2')
    expect(resolveFloatingArrowBox({ tipRadius: 2 }).width).toBe(22)
  })

  it('未传旧半径参数时使用新的贝塞尔默认轮廓', () => {
    const geometry = resolveFloatingArrowGeometry()

    expect(geometry.width).toBe(24)
    expect(geometry.height).toBe(7)
    expect(geometry.path).toContain('C')
  })
})

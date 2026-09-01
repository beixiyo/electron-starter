/** 验证快捷键展示能让用户辨认左右物理修饰键 */
import { describe, expect, it } from 'vitest'
import { formatBinding } from './types'

describe('快捷键展示', () => {
  it('左右 Option 使用不同文案', () => {
    const left = formatBinding({
      gesture: 'press',
      chord: { source: 'keyboard', key: 'AltLeft', modifiers: [] },
    })
    const right = formatBinding({
      gesture: 'press',
      chord: { source: 'keyboard', key: 'AltRight', modifiers: [] },
    })

    expect(left).toContain('Left')
    expect(right).toContain('Right')
    expect(left).not.toBe(right)
  })
})

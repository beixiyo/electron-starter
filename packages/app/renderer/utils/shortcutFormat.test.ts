import { describe, expect, it } from 'vitest'
import { formatBinding } from './shortcutFormat'

describe('快捷键格式化', () => {
  it('固定修饰键顺序并保留左右侧别', () => {
    expect(formatBinding({
      gesture: 'press',
      chord: {
        source: 'keyboard',
        key: 'R',
        modifiers: ['MetaLeft', 'ShiftLeft', 'ControlLeft'],
      },
    })).toBe('Left ⌃ + Left ⇧ + Left ⌘ + R')
  })

  it('双击重复显示同一个组合', () => {
    expect(formatBinding({
      gesture: 'doublePress',
      chord: { source: 'fn', key: 'Fn' },
    })).toBe('fn + fn')
  })

  it('方向键组合和额外键都保留可辨认文本', () => {
    expect(formatBinding({
      gesture: 'press',
      chord: {
        source: 'keyboard',
        key: 'ArrowUp',
        modifiers: [],
        keys: ['ArrowLeft'],
      },
    })).toBe('Up ↑ + Left ←')

    expect(formatBinding({
      gesture: 'press',
      chord: { source: 'keyboard', key: 'A', modifiers: [] },
    }, { extraKeys: ['2'] })).toBe('A + 2')
  })
})

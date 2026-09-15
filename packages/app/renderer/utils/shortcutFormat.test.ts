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

  it('方向键组合保留可辨认文本，成员接在主键后面', () => {
    expect(formatBinding({
      gesture: 'press',
      chord: {
        source: 'keyboard',
        key: 'ArrowUp',
        modifiers: [],
        keys: ['ArrowLeft'],
      },
    })).toBe('Up ↑ + Left ←')
  })

  it('Fn 组合键的成员同样接在主键后面', () => {
    expect(formatBinding({
      gesture: 'press',
      chord: {
        source: 'fn',
        key: 'BracketLeft',
        modifiers: [],
        keys: ['BracketRight'],
      },
    })).toBe('fn + [ + ]')
  })

  /** 修复前 Fn chord 只存逻辑家族，单独 ⌥ 显示 `Left ⌥` 而 `fn + ⌥` 丢掉侧别 */
  it('录制得到的 fn + 修饰键与 keyboard chord 一样带侧别', () => {
    expect(formatBinding({
      gesture: 'press',
      chord: { source: 'fn', key: 'Fn', modifiers: ['AltLeft'] },
    })).toBe('fn + Left ⌥')

    expect(formatBinding({
      gesture: 'press',
      chord: { source: 'fn', key: 'Space', modifiers: ['ShiftRight'] },
    })).toBe('fn + Right ⇧ + Space')
  })
})

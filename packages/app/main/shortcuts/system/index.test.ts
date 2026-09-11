/**
 * symbolichotkeys plist 的解码边界：结构取自真机 `plutil -convert json` 的输出
 *
 * 守的是「解码错一个字段就把合法组合判成系统保留键」这类静默误判：plist 的
 * `parameters` 是裸数组、掩码是 NSEvent 位标志，任何一处错位都不会报错，只会让
 * 录制校验把用户能用的组合拒掉，或者反过来放过真正冲突的组合
 */

import { describe, expect, it } from 'vitest'
import { parseSymbolicHotKeys } from '.'

describe('macOS 系统快捷键解码', () => {
  it('把启用条目解码为 chord', () => {
    /** id 64 是 Spotlight：keycode 49 = Space，掩码 0x100000 = Command */
    const chords = parseSymbolicHotKeys({
      AppleSymbolicHotKeys: {
        64: { enabled: true, value: { type: 'standard', parameters: [65535, 49, 0x100000] } },
      },
    })

    expect(chords).toEqual([{ source: 'keyboard', key: 'Space', modifiers: ['Meta'] }])
  })

  it('跳过被用户关掉的条目', () => {
    const chords = parseSymbolicHotKeys({
      AppleSymbolicHotKeys: {
        98: { enabled: false, value: { type: 'standard', parameters: [47, 44, 0x120000] } },
      },
    })

    expect(chords).toEqual([])
  })

  it('跳过没写按键的条目', () => {
    /** 从未被改过的系统默认快捷键只落 `{ enabled: true }`，按键读不到 */
    expect(parseSymbolicHotKeys({ AppleSymbolicHotKeys: { 79: { enabled: true } } })).toEqual([])
  })

  it('跳过 modifier 类型的条目', () => {
    /**
     * `type: 'modifier'` 描述的是「单独按某个修饰键做什么」，fn 弹输入法菜单就是这条。
     * 把它算成保留键会让以裸 Fn 为默认值的绑定自己非法
     */
    const chords = parseSymbolicHotKeys({
      AppleSymbolicHotKeys: {
        164: { enabled: true, value: { type: 'modifier', parameters: [0x800000, 4286578687] } },
      },
    })

    expect(chords).toEqual([])
  })

  it('带 fn 掩码的条目解码成 Fn 组合', () => {
    const chords = parseSymbolicHotKeys({
      AppleSymbolicHotKeys: {
        1: { enabled: true, value: { type: 'standard', parameters: [65535, 0x60, 0x800000] } },
      },
    })

    expect(chords).toEqual([{ source: 'fn', key: 'F5', modifiers: [] }])
  })

  it('多修饰键按 ⌃ ⌥ ⇧ ⌘ 之外的家族顺序也能识别', () => {
    const chords = parseSymbolicHotKeys({
      AppleSymbolicHotKeys: {
        52: { enabled: true, value: { type: 'standard', parameters: [100, 2, 0x180000] } },
      },
    })

    /** id 52 是 Dock 隐藏：⌥⌘D */
    expect(chords).toEqual([{ source: 'keyboard', key: 'D', modifiers: ['Meta', 'Alt'] }])
  })

  it('结构不对时返回空，不抛错', () => {
    expect(parseSymbolicHotKeys(null)).toEqual([])
    expect(parseSymbolicHotKeys({})).toEqual([])
    expect(parseSymbolicHotKeys({ AppleSymbolicHotKeys: { 1: { enabled: true, value: { type: 'standard', parameters: ['x'] } } } })).toEqual([])
  })
})

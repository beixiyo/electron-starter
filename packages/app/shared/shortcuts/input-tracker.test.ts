/**
 * 输入 tracker：原始物理输入合成 chord 事件的边界
 *
 * 守的是三条跨后端契约：Fn 组合只在 Fn 按住且后端确认时成立、修饰键永远走 keyboard 路径、
 * Fn 先松开时按 down 顺序结束全部组合。这些以前分散在各后端的录制层里，
 * 现在所有后端共用这一份，漂移只会发生在这里
 */
import { describe, expect, it } from 'vitest'
import { createKeyboardInputTracker } from './input-tracker'
import type { KeyboardInput, KeyboardInputEvent } from './types'

describe('键盘输入 tracker', () => {
  it('Fn 组合键在 down 时冻结逻辑修饰键，up 复用同一 chord', () => {
    const tracker = createKeyboardInputTracker()

    expect(tracker.handle(input('down', 'Fn'))).toEqual([
      { phase: 'down', chord: { source: 'fn', key: 'Fn' }, timestamp: 1 },
    ])
    expect(tracker.handle(input('down', 'Space', { fn: true, modifiers: ['Meta'] }))).toEqual([
      { phase: 'down', chord: { source: 'fn', key: 'Space', modifiers: ['Meta'] }, timestamp: 1 },
    ])
    expect(tracker.handle(input('up', 'Space', { fn: true }))).toEqual([
      { phase: 'up', chord: { source: 'fn', key: 'Space', modifiers: ['Meta'] }, timestamp: 1 },
    ])
    expect(tracker.handle(input('up', 'Fn'))).toEqual([
      { phase: 'up', chord: { source: 'fn', key: 'Fn' }, timestamp: 1 },
    ])
  })

  it('Fn 先松开时按 down 顺序结束全部组合，随后的物理 up 不再产生事件', () => {
    const tracker = createKeyboardInputTracker()
    tracker.handle(input('down', 'Fn'))
    tracker.handle(input('down', 'Space', { fn: true }))
    tracker.handle(input('down', 'A', { fn: true }))

    expect(tracker.handle(input('up', 'Fn')).map(event => `${event.phase}:${event.chord.key}`)).toEqual([
      'up:Space',
      'up:A',
      'up:Fn',
    ])
    expect(tracker.handle(input('up', 'Space'))).toEqual([])
    expect(tracker.handle(input('up', 'A'))).toEqual([])
  })

  it('Fn 没有按住时 fn 标记被忽略，按普通键处理', () => {
    const tracker = createKeyboardInputTracker()

    expect(tracker.handle(input('down', 'S', { fn: true }))).toEqual([
      { phase: 'down', chord: { source: 'keyboard', key: 'S', modifiers: [] }, timestamp: 1 },
    ])
  })

  it('Fn 按住时修饰键仍走 keyboard 路径，并作为 Fn 组合的逻辑修饰键出现', () => {
    const tracker = createKeyboardInputTracker()
    tracker.handle(input('down', 'Fn'))

    expect(tracker.handle(input('down', 'ShiftLeft', { fn: true, modifiers: ['Shift'] }))).toEqual([
      { phase: 'down', chord: { source: 'keyboard', key: 'ShiftLeft', modifiers: [] }, timestamp: 1 },
    ])
    expect(tracker.handle(input('down', 'S', { fn: true, modifiers: ['Shift'] }))).toEqual([
      { phase: 'down', chord: { source: 'fn', key: 'S', modifiers: ['Shift'] }, timestamp: 1 },
    ])
  })

  it('普通键盘组合保留已按住修饰键的物理侧别；成员松开后清理依赖 chord', () => {
    const tracker = createKeyboardInputTracker()

    tracker.handle(input('down', 'AltRight', { modifiers: ['Alt'] }))
    expect(tracker.handle(input('down', 'A', { modifiers: ['Alt'] }))).toEqual([
      { phase: 'down', chord: { source: 'keyboard', key: 'A', modifiers: ['AltRight'] }, timestamp: 1 },
    ])
    expect(tracker.handle(input('up', 'AltRight')).map(event => event.chord)).toEqual([
      { source: 'keyboard', key: 'A', modifiers: ['AltRight'] },
      { source: 'keyboard', key: 'AltRight', modifiers: [] },
    ])
    expect(tracker.handle(input('down', 'B'))).toEqual([
      { phase: 'down', chord: { source: 'keyboard', key: 'B', modifiers: [] }, timestamp: 1 },
    ])
  })

  it('重复 down、锁定键和 reset 之后的孤儿 up 都不产生事件', () => {
    const tracker = createKeyboardInputTracker()

    expect(tracker.handle(input('down', 'A'))).toHaveLength(1)
    expect(tracker.handle(input('down', 'A'))).toEqual([])
    expect(tracker.handle(input('down', 'CapsLock'))).toEqual([])

    tracker.handle(input('down', 'Fn'))
    expect(tracker.handle({ phase: 'reset', timestamp: 9 })).toEqual([])
    expect(tracker.isFnDown).toBe(false)
    expect(tracker.handle(input('up', 'A'))).toEqual([])
    expect(tracker.handle(input('up', 'Fn'))).toEqual([])
  })
})

function input(
  phase: 'down' | 'up',
  key: KeyboardInputEvent['key'],
  overrides: Partial<Pick<KeyboardInputEvent, 'fn' | 'modifiers'>> = {},
): KeyboardInput {
  return {
    phase,
    key,
    modifiers: overrides.modifiers ?? [],
    fn: overrides.fn ?? false,
    timestamp: 1,
  }
}

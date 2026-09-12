/**
 * 输入 tracker：原始物理输入合成 chord 事件的边界
 *
 * 守的是四条跨后端契约：Fn 组合只在 Fn 按住且后端确认时成立、修饰键永远走 keyboard 路径、
 * Fn 与修饰键同时按住时另合成 fn + 修饰键 chord、Fn 先松开时按 down 顺序结束全部组合。
 * 这些以前分散在各后端的录制层里，
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

  it('Fn 按住时修饰键仍走 keyboard 路径，同时另发 fn + 修饰键 chord', () => {
    const tracker = createKeyboardInputTracker()
    tracker.handle(input('down', 'Fn'))

    expect(tracker.handle(input('down', 'ShiftLeft', { fn: true, modifiers: ['Shift'] }))).toEqual([
      { phase: 'down', chord: { source: 'keyboard', key: 'ShiftLeft', modifiers: [] }, timestamp: 1 },
      { phase: 'down', chord: { source: 'fn', key: 'Fn', modifiers: ['Shift'] }, timestamp: 1 },
    ])
    expect(tracker.handle(input('down', 'S', { fn: true, modifiers: ['Shift'] }))).toEqual([
      { phase: 'down', chord: { source: 'fn', key: 'S', modifiers: ['Shift'] }, timestamp: 1 },
    ])
  })

  it('Fn 与修饰键不论谁先按都合成同一个 fn + 修饰键 chord，成员松开即结束', () => {
    const fnMeta = { source: 'fn', key: 'Fn', modifiers: ['Meta'] }
    const bareMeta = { source: 'keyboard', key: 'MetaLeft', modifiers: [] }

    const fnFirst = createKeyboardInputTracker()
    fnFirst.handle(input('down', 'Fn'))
    fnFirst.handle(input('down', 'MetaLeft', { fn: true, modifiers: ['Meta'] }))
    expect(fnFirst.handle(input('up', 'MetaLeft', { fn: true })).map(event => event.chord)).toEqual([fnMeta, bareMeta])
    expect(fnFirst.handle(input('up', 'Fn')).map(event => event.chord)).toEqual([{ source: 'fn', key: 'Fn' }])

    const metaFirst = createKeyboardInputTracker()
    metaFirst.handle(input('down', 'MetaLeft', { modifiers: ['Meta'] }))
    expect(metaFirst.handle(input('down', 'Fn')).map(event => event.chord)).toEqual([fnMeta])
    expect(metaFirst.handle(input('up', 'Fn')).map(event => event.chord)).toEqual([fnMeta])
    expect(metaFirst.handle(input('up', 'MetaLeft')).map(event => event.chord)).toEqual([bareMeta])
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

  it('同组的方向键同时按住合成一个 chord，与按下顺序无关；组外普通键仍是独立 chord', () => {
    const upLeft = { source: 'keyboard', key: 'ArrowUp', modifiers: [], keys: ['ArrowLeft'] }

    const upFirst = createKeyboardInputTracker()
    upFirst.handle(input('down', 'ArrowUp'))
    expect(upFirst.handle(input('down', 'ArrowLeft')).map(event => event.chord)).toEqual([upLeft])
    expect(upFirst.handle(input('down', 'A')).map(event => event.chord)).toEqual([
      { source: 'keyboard', key: 'A', modifiers: [] },
    ])
    expect(upFirst.handle(input('up', 'ArrowUp')).map(event => event.chord)).toEqual([
      upLeft,
      { source: 'keyboard', key: 'ArrowUp', modifiers: [] },
    ])
    expect(upFirst.handle(input('up', 'ArrowLeft')).map(event => event.chord)).toEqual([
      { source: 'keyboard', key: 'ArrowLeft', modifiers: [] },
    ])

    const leftFirst = createKeyboardInputTracker()
    leftFirst.handle(input('down', 'ArrowLeft'))
    expect(leftFirst.handle(input('down', 'ArrowUp')).map(event => event.chord)).toEqual([upLeft])
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

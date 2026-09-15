/**
 * 输入 tracker：原始物理输入合成 chord 事件的边界
 *
 * 守的是五条跨后端契约：Fn 组合只在 Fn 按住且后端确认时成立、修饰键永远走 keyboard 路径、
 * Fn 与修饰键同时按住时另合成 fn + 修饰键 chord、Fn 先松开时按 down 顺序结束全部组合、
 * 多个普通键同时按住合成一个 chord。这些以前分散在各后端的录制层里，
 * 现在所有后端共用这一份，漂移只会发生在这里
 */
import { describe, expect, it } from 'vitest'
import { createKeyboardInputTracker } from './input-tracker'
import type { KeyboardInput, KeyboardInputEvent } from './types'

describe('键盘输入 tracker', () => {
  /** 事件只给逻辑家族；tracker 没记录到对应物理键时原样保留，运行时按「任一侧」匹配 */
  it('Fn 组合键在 down 时冻结修饰键，补不出侧别时保留逻辑家族，up 复用同一 chord', () => {
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

    /** A 在 Space 按住时按下，冻结成 `fn + Space + A`；Space 自己的 chord 仍是 down 时的 `fn + Space` */
    expect(tracker.handle(input('up', 'Fn'))).toEqual([
      { phase: 'up', chord: { source: 'fn', key: 'Space', modifiers: [] }, timestamp: 1 },
      { phase: 'up', chord: { source: 'fn', key: 'Space', modifiers: [], keys: ['A'] }, timestamp: 1 },
      { phase: 'up', chord: { source: 'fn', key: 'Fn' }, timestamp: 1 },
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

  /**
   * 修复前 Fn 路径把修饰键收敛成逻辑家族，`fn + Left ⌥` 录出来只有 `fn + ⌥`，与 keyboard chord
   * 的 `Left ⌥ + A` 不一致；现在两条路径都带物理侧别，事件给的逻辑 flags 按 tracker 按住状态补齐
   */
  it('Fn 按住时修饰键仍走 keyboard 路径，同时另发 fn + 修饰键 chord，并以物理侧别进入 Fn 组合', () => {
    const tracker = createKeyboardInputTracker()
    tracker.handle(input('down', 'Fn'))

    expect(tracker.handle(input('down', 'ShiftLeft', { fn: true, modifiers: ['Shift'] }))).toEqual([
      { phase: 'down', chord: { source: 'keyboard', key: 'ShiftLeft', modifiers: [] }, timestamp: 1 },
      { phase: 'down', chord: { source: 'fn', key: 'Fn', modifiers: ['ShiftLeft'] }, timestamp: 1 },
    ])
    expect(tracker.handle(input('down', 'S', { fn: true, modifiers: ['Shift'] }))).toEqual([
      { phase: 'down', chord: { source: 'fn', key: 'S', modifiers: ['ShiftLeft'] }, timestamp: 1 },
    ])
  })

  it('左右两侧同时按住时 Fn 修饰键 chord 按物理键结束，松开一侧就不再成立', () => {
    const tracker = createKeyboardInputTracker()
    tracker.handle(input('down', 'Fn'))
    tracker.handle(input('down', 'MetaLeft', { fn: true, modifiers: ['Meta'] }))
    tracker.handle(input('down', 'MetaRight', { fn: true, modifiers: ['Meta'] }))

    /** 两个 Fn 修饰键 chord 都含 Left ⌘，一起结束；keyboard 路径照旧结束依赖 Left ⌘ 的组合与裸 Left ⌘ */
    expect(tracker.handle(input('up', 'MetaLeft', { fn: true, modifiers: ['Meta'] })).map(event => event.chord)).toEqual([
      { source: 'fn', key: 'Fn', modifiers: ['MetaLeft', 'MetaRight'] },
      { source: 'fn', key: 'Fn', modifiers: ['MetaLeft'] },
      { source: 'keyboard', key: 'MetaLeft', modifiers: ['MetaRight'] },
      { source: 'keyboard', key: 'MetaLeft', modifiers: [] },
    ])
  })

  /**
   * 修复前 Fn 自身的按下事件固定不带 modifiers，先按 ⌘ 再按 Fn 只得到裸 Fn；
   * 两种顺序都要收敛到同一个 `fn + ⌘`，且松开任一成员时它就结束
   */
  it('Fn 与修饰键不论谁先按都合成同一个 fn + 修饰键 chord，成员松开即结束', () => {
    const fnMeta = { source: 'fn', key: 'Fn', modifiers: ['MetaLeft'] }
    const bareMeta = { source: 'keyboard', key: 'MetaLeft', modifiers: [] }

    const fnFirst = createKeyboardInputTracker()
    fnFirst.handle(input('down', 'Fn'))
    fnFirst.handle(input('down', 'MetaLeft', { fn: true, modifiers: ['Meta'] }))
    expect(fnFirst.handle(input('up', 'MetaLeft', { fn: true })).map(event => event.chord)).toEqual([fnMeta, bareMeta])
    /** ⌘ 松开后只剩裸 Fn 按住，Fn 键自己的 chord 仍是 down 时冻结的裸 Fn */
    expect(fnFirst.handle(input('up', 'Fn')).map(event => event.chord)).toEqual([{ source: 'fn', key: 'Fn' }])

    const metaFirst = createKeyboardInputTracker()
    metaFirst.handle(input('down', 'MetaLeft', { modifiers: ['Meta'] }))
    expect(metaFirst.handle(input('down', 'Fn')).map(event => event.chord)).toEqual([fnMeta])
    /** Fn 先松开时 `fn + ⌘` 随之结束；之后松开 ⌘ 只剩 keyboard 路径的裸 ⌘ */
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
    /** 仍按住的 A 已重算成裸 A；松开后再按 B 不会继承已松开的 ⌥ */
    expect(tracker.handle(input('up', 'A')).map(event => event.chord)).toEqual([
      { source: 'keyboard', key: 'A', modifiers: [] },
    ])
    expect(tracker.handle(input('down', 'B'))).toEqual([
      { phase: 'down', chord: { source: 'keyboard', key: 'B', modifiers: [] }, timestamp: 1 },
    ])
  })

  /** 以前只有同组方向键能合成 chord，`[` 按住再按 `]` 只是另一个独立 chord */
  it('多个普通键同时按住合成一个 chord，主键按规范键名顺序归一、与按下顺序无关', () => {
    const bracketPair = { source: 'keyboard', key: 'BracketLeft', modifiers: [], keys: ['BracketRight'] }

    const leftFirst = createKeyboardInputTracker()
    leftFirst.handle(input('down', 'BracketLeft'))
    expect(leftFirst.handle(input('down', 'BracketRight')).map(event => event.chord)).toEqual([bracketPair])
    /** 第三个普通键把此刻按住的两个一并冻结进来 */
    expect(leftFirst.handle(input('down', 'A')).map(event => event.chord)).toEqual([
      { source: 'keyboard', key: 'A', modifiers: [], keys: ['BracketLeft', 'BracketRight'] },
    ])
    /** `[` 松开结束依赖它的全部 chord（成员多的在前），剩下的键重算成不含 `[` 的组合 */
    expect(leftFirst.handle(input('up', 'BracketLeft')).map(event => event.chord)).toEqual([
      { source: 'keyboard', key: 'A', modifiers: [], keys: ['BracketLeft', 'BracketRight'] },
      bracketPair,
      { source: 'keyboard', key: 'BracketLeft', modifiers: [] },
    ])
    expect(leftFirst.handle(input('up', 'A')).map(event => event.chord)).toEqual([
      { source: 'keyboard', key: 'A', modifiers: [], keys: ['BracketRight'] },
    ])
    expect(leftFirst.handle(input('up', 'BracketRight')).map(event => event.chord)).toEqual([
      { source: 'keyboard', key: 'BracketRight', modifiers: [] },
    ])

    const rightFirst = createKeyboardInputTracker()
    rightFirst.handle(input('down', 'BracketRight'))
    expect(rightFirst.handle(input('down', 'BracketLeft')).map(event => event.chord)).toEqual([bracketPair])
  })

  it('Fn 按住时多个组合键合成一个 Fn chord，成员松开只结束依赖它的组合', () => {
    const tracker = createKeyboardInputTracker()
    tracker.handle(input('down', 'Fn'))
    tracker.handle(input('down', 'BracketRight', { fn: true }))

    expect(tracker.handle(input('down', 'BracketLeft', { fn: true })).map(event => event.chord)).toEqual([
      { source: 'fn', key: 'BracketLeft', modifiers: [], keys: ['BracketRight'] },
    ])
    expect(tracker.handle(input('up', 'BracketLeft', { fn: true })).map(event => event.chord)).toEqual([
      { source: 'fn', key: 'BracketLeft', modifiers: [], keys: ['BracketRight'] },
    ])
    expect(tracker.handle(input('up', 'BracketRight', { fn: true })).map(event => event.chord)).toEqual([
      { source: 'fn', key: 'BracketRight', modifiers: [] },
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

import type { KeyboardInputEvent, ShortcutRecordEvent } from './types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKeyboardInputTracker } from './input-tracker'
import { createShortcutRecordEngine } from './record-engine'
import { canShortcutChordDoublePress } from './validation'

describe('快捷键录制手势优先级', () => {
  afterEach(() => vi.useRealTimers())

  it('第二次长按优先识别 hold，而不是在 keydown 时提前识别 doublePress', async () => {
    vi.useFakeTimers()
    const detected: string[] = []
    const engine = createShortcutRecordEngine({
      onPhaseChange: vi.fn(),
      onDetectedChange: (detection) => {
        if (detection)
          detected.push(detection.binding.gesture)
      },
    })
    engine.start(['press', 'doublePress', 'hold'])

    engine.handle(event('down', 0))
    engine.handle(event('up', 50))
    engine.handle(event('down', 100))
    await vi.advanceTimersByTimeAsync(400)

    expect(detected).toEqual(['hold'])
  })

  it('单独长按修饰键可以被识别为 hold', async () => {
    vi.useFakeTimers()
    const onDetectedChange = vi.fn()
    const engine = createShortcutRecordEngine({
      onPhaseChange: vi.fn(),
      onDetectedChange,
    })
    engine.start(['hold'])

    engine.handle(modifierEvent('down', 'MetaLeft', [], 0))
    await vi.advanceTimersByTimeAsync(399)
    expect(onDetectedChange).toHaveBeenLastCalledWith(null)

    await vi.advanceTimersByTimeAsync(1)

    expect(onDetectedChange).toHaveBeenLastCalledWith({
      binding: {
        gesture: 'hold',
        chord: { source: 'keyboard', key: 'MetaLeft', modifiers: [] },
        minDurationMs: 400,
      },
      extraKeys: [],
    })
  })

  it('固定录制 hold 时，阈值前松手不会被保存为长按', () => {
    const onDetectedChange = vi.fn()
    const onPhaseChange = vi.fn()
    const engine = createShortcutRecordEngine({
      onPhaseChange,
      onDetectedChange,
    })
    engine.start(['hold'])

    engine.handle(modifierEvent('down', 'MetaLeft', [], 0))
    engine.handle(modifierEvent('up', 'MetaLeft', [], 399))

    expect(onDetectedChange).not.toHaveBeenCalledWith(expect.objectContaining({
      binding: expect.objectContaining({ gesture: 'press' }),
    }))
    expect(onPhaseChange).toHaveBeenLastCalledWith('waiting')
  })

  it('后按下的键替换修饰键候选并保留已按住的修饰键', () => {
    const onDetectedChange = vi.fn()
    const engine = createShortcutRecordEngine({
      onPhaseChange: vi.fn(),
      onDetectedChange,
    })
    engine.start(['press'])

    engine.handle(modifierEvent('down', 'MetaLeft', [], 0))
    engine.handle(modifierEvent('down', 'MetaLeft', ['AltRight'], 20))
    engine.handle(modifierEvent('up', 'MetaLeft', [], 40))
    engine.handle(modifierEvent('up', 'MetaLeft', ['AltRight'], 60))

    expect(onDetectedChange).toHaveBeenLastCalledWith({
      binding: {
        gesture: 'press',
        chord: { source: 'keyboard', key: 'MetaLeft', modifiers: ['AltRight'] },
      },
      extraKeys: [],
    })
  })

  it('普通主键同样替换前置修饰键候选', () => {
    const onDetectedChange = vi.fn()
    const engine = createShortcutRecordEngine({
      onPhaseChange: vi.fn(),
      onDetectedChange,
    })
    engine.start(['press'])

    engine.handle(modifierEvent('down', 'MetaLeft', [], 0))
    engine.handle({
      phase: 'down',
      timestamp: 20,
      chord: { source: 'keyboard', key: 'A', modifiers: ['MetaLeft'] },
    })
    engine.handle({
      phase: 'up',
      timestamp: 40,
      chord: { source: 'keyboard', key: 'A', modifiers: ['MetaLeft'] },
    })

    expect(onDetectedChange).toHaveBeenLastCalledWith({
      binding: {
        gesture: 'press',
        chord: { source: 'keyboard', key: 'A', modifiers: ['MetaLeft'] },
      },
      extraKeys: [],
    })
  })

  it('主键按住期间按下的其他普通键随结果一起吐出，修饰键不算', () => {
    const onDetectedChange = vi.fn()
    const engine = createShortcutRecordEngine({
      onPhaseChange: vi.fn(),
      onDetectedChange,
    })
    engine.start(['press'])

    engine.handle(keyEvent('down', 'A', 0))
    engine.handle(keyEvent('down', '2', 20))
    engine.handle(modifierEvent('down', 'MetaLeft', [], 30))
    engine.handle(keyEvent('down', '2', 35))
    engine.handle(keyEvent('up', '2', 40))
    engine.handle(keyEvent('up', 'A', 60))

    expect(onDetectedChange).toHaveBeenLastCalledWith({
      binding: {
        gesture: 'press',
        chord: { source: 'keyboard', key: 'A', modifiers: [] },
      },
      extraKeys: ['2'],
    })
  })

  it('多主键组合不受本轮手势限制，长按类动作也能收到用于回显', async () => {
    vi.useFakeTimers()
    const onDetectedChange = vi.fn()
    const engine = createShortcutRecordEngine({
      onPhaseChange: vi.fn(),
      onDetectedChange,
    })
    engine.start(['hold'])

    engine.handle(keyEvent('down', 'A', 0))
    engine.handle(keyEvent('down', 'B', 20))
    await vi.advanceTimersByTimeAsync(500)
    engine.handle(keyEvent('up', 'A', 520))

    expect(onDetectedChange).toHaveBeenCalledTimes(2)
    expect(onDetectedChange).toHaveBeenLastCalledWith({
      binding: {
        gesture: 'press',
        chord: { source: 'keyboard', key: 'A', modifiers: [] },
      },
      extraKeys: ['B'],
    })
  })

  it('实时回显跟着按住的键与额外键走，松手判定后清空', () => {
    const onActiveChange = vi.fn()
    const engine = createShortcutRecordEngine({
      onPhaseChange: vi.fn(),
      onDetectedChange: vi.fn(),
      onActiveChange,
    })
    engine.start(['press'])

    engine.handle(keyEvent('down', 'A', 0))
    engine.handle(keyEvent('down', '2', 20))
    engine.handle(keyEvent('up', 'A', 40))

    expect(onActiveChange.mock.calls.map(([active]) => active)).toEqual([
      { chord: { source: 'keyboard', key: 'A', modifiers: [] }, extraKeys: [] },
      { chord: { source: 'keyboard', key: 'A', modifiers: [] }, extraKeys: ['2'] },
      null,
    ])
  })

  it('双击等待中仍回显松开的键，超时判定后才清空', async () => {
    vi.useFakeTimers()
    const onActiveChange = vi.fn()
    const engine = createShortcutRecordEngine({
      onPhaseChange: vi.fn(),
      onDetectedChange: vi.fn(),
      onActiveChange,
      doublePressIntervalMs: 300,
    })
    engine.start(['press', 'doublePress'])

    const fn = { source: 'fn', key: 'Fn' } as const
    engine.handle({ phase: 'down', chord: fn, timestamp: 0 })
    engine.handle({ phase: 'up', chord: fn, timestamp: 50 })
    expect(onActiveChange).toHaveBeenLastCalledWith({ chord: fn, extraKeys: [] })

    await vi.advanceTimersByTimeAsync(300)
    expect(onActiveChange).toHaveBeenLastCalledWith(null)
  })
})

describe('Fn 与修饰键组合录制', () => {
  afterEach(() => vi.useRealTimers())

  it('Fn 与修饰键不论谁先按都录成同一个组合，且不等双击窗口', () => {
    vi.useFakeTimers()
    const fnMetaPress = {
      binding: { gesture: 'press', chord: { source: 'fn', key: 'Fn', modifiers: ['Meta'] } },
      extraKeys: [],
    }

    expect(recordRawInputs([
      raw('down', 'Fn', 0),
      raw('down', 'MetaLeft', 50, { fn: true, modifiers: ['Meta'] }),
      raw('up', 'MetaLeft', 100, { fn: true }),
      raw('up', 'Fn', 150),
    ])).toEqual(fnMetaPress)

    expect(recordRawInputs([
      raw('down', 'MetaLeft', 0, { modifiers: ['Meta'] }),
      raw('down', 'Fn', 50),
      raw('up', 'Fn', 100),
      raw('up', 'MetaLeft', 150),
    ])).toEqual(fnMetaPress)
  })

  it('Fn 按住期间实时回显跟着修饰键走', () => {
    const tracker = createKeyboardInputTracker()
    const onActiveChange = vi.fn()
    const engine = createShortcutRecordEngine({
      onPhaseChange: vi.fn(),
      onDetectedChange: vi.fn(),
      onActiveChange,
      canDoublePress: canShortcutChordDoublePress,
    })
    engine.start(['press', 'doublePress'])

    for (const event of tracker.handle(raw('down', 'Fn', 0))) engine.handle(event)
    for (const event of tracker.handle(raw('down', 'ShiftLeft', 20, { fn: true, modifiers: ['Shift'] }))) engine.handle(event)

    expect(onActiveChange.mock.calls.map(([active]) => active?.chord)).toEqual([
      { source: 'fn', key: 'Fn' },
      { source: 'fn', key: 'Fn', modifiers: ['Shift'] },
    ])
  })
})

describe('方向键组合录制', () => {
  it('两个方向键录成一个 chord，方向键加普通键仍是多主键组合', () => {
    expect(recordRawInputs([
      raw('down', 'ArrowLeft', 0),
      raw('down', 'ArrowUp', 20),
      raw('up', 'ArrowLeft', 40),
      raw('up', 'ArrowUp', 60),
    ])).toEqual({
      binding: { gesture: 'press', chord: { source: 'keyboard', key: 'ArrowUp', modifiers: [], keys: ['ArrowLeft'] } },
      extraKeys: [],
    })

    expect(recordRawInputs([
      raw('down', 'ArrowUp', 0),
      raw('down', 'A', 20),
      raw('up', 'A', 40),
      raw('up', 'ArrowUp', 60),
    ])).toEqual({
      binding: { gesture: 'press', chord: { source: 'keyboard', key: 'ArrowUp', modifiers: [] } },
      extraKeys: ['A'],
    })
  })
})

/** 把原始输入喂给 tracker 与录制引擎，返回最后一次录制结果 */
function recordRawInputs(inputs: KeyboardInputEvent[]) {
  const tracker = createKeyboardInputTracker()
  const onDetectedChange = vi.fn()
  const engine = createShortcutRecordEngine({
    onPhaseChange: vi.fn(),
    onDetectedChange,
    canDoublePress: canShortcutChordDoublePress,
  })
  engine.start(['press', 'doublePress'])

  for (const input of inputs) {
    for (const event of tracker.handle(input)) engine.handle(event)
  }

  return onDetectedChange.mock.lastCall?.[0]
}

function raw(
  phase: 'down' | 'up',
  key: KeyboardInputEvent['key'],
  timestamp: number,
  overrides: Partial<Pick<KeyboardInputEvent, 'fn' | 'modifiers'>> = {},
): KeyboardInputEvent {
  return {
    phase,
    key,
    modifiers: overrides.modifiers ?? [],
    fn: overrides.fn ?? false,
    timestamp,
  }
}

function keyEvent(phase: 'down' | 'up', key: 'A' | 'B' | '2', timestamp: number): ShortcutRecordEvent {
  return {
    phase,
    timestamp,
    chord: { source: 'keyboard', key, modifiers: [] },
  }
}

function event(phase: 'down' | 'up', timestamp: number): ShortcutRecordEvent {
  return {
    phase,
    timestamp,
    chord: { source: 'keyboard', key: 'V', modifiers: [] },
  }
}

function modifierEvent(
  phase: 'down' | 'up',
  key: 'MetaLeft' | 'AltRight',
  modifiers: Array<'MetaLeft' | 'AltRight'>,
  timestamp: number,
): ShortcutRecordEvent {
  return {
    phase,
    timestamp,
    chord: { source: 'keyboard', key, modifiers },
  }
}

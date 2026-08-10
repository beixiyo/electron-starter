import type { ShortcutRecordEvent } from './types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createShortcutRecordEngine } from './record-engine'

describe('快捷键录制手势优先级', () => {
  afterEach(() => vi.useRealTimers())

  it('第二次长按优先识别 hold，而不是在 keydown 时提前识别 doublePress', async () => {
    vi.useFakeTimers()
    const detected: string[] = []
    const engine = createShortcutRecordEngine({
      onPhaseChange: vi.fn(),
      onDetectedChange: (binding) => {
        if (binding)
          detected.push(binding.gesture)
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

    engine.handle(modifierEvent('down', 'Meta', [], 0))
    await vi.advanceTimersByTimeAsync(399)
    expect(onDetectedChange).toHaveBeenLastCalledWith(null)

    await vi.advanceTimersByTimeAsync(1)

    expect(onDetectedChange).toHaveBeenLastCalledWith({
      gesture: 'hold',
      chord: { source: 'keyboard', key: 'Meta', modifiers: [] },
      minDurationMs: 400,
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

    engine.handle(modifierEvent('down', 'Meta', [], 0))
    engine.handle(modifierEvent('up', 'Meta', [], 399))

    expect(onDetectedChange).toHaveBeenLastCalledWith({
      gesture: 'press',
      chord: { source: 'keyboard', key: 'Meta', modifiers: [] },
    })
    expect(onPhaseChange).toHaveBeenLastCalledWith('unsupported')
  })

  it('后按下的键替换修饰键候选并保留已按住的修饰键', () => {
    const onDetectedChange = vi.fn()
    const engine = createShortcutRecordEngine({
      onPhaseChange: vi.fn(),
      onDetectedChange,
    })
    engine.start(['press'])

    engine.handle(modifierEvent('down', 'Meta', [], 0))
    engine.handle(modifierEvent('down', 'Meta', ['Alt'], 20))
    engine.handle(modifierEvent('up', 'Meta', [], 40))
    engine.handle(modifierEvent('up', 'Meta', ['Alt'], 60))

    expect(onDetectedChange).toHaveBeenLastCalledWith({
      gesture: 'press',
      chord: { source: 'keyboard', key: 'Meta', modifiers: ['Alt'] },
    })
  })

  it('普通主键同样替换前置修饰键候选', () => {
    const onDetectedChange = vi.fn()
    const engine = createShortcutRecordEngine({
      onPhaseChange: vi.fn(),
      onDetectedChange,
    })
    engine.start(['press'])

    engine.handle(modifierEvent('down', 'Meta', [], 0))
    engine.handle({
      phase: 'down',
      timestamp: 20,
      chord: { source: 'keyboard', key: 'A', modifiers: ['Meta'] },
    })
    engine.handle({
      phase: 'up',
      timestamp: 40,
      chord: { source: 'keyboard', key: 'A', modifiers: ['Meta'] },
    })

    expect(onDetectedChange).toHaveBeenLastCalledWith({
      gesture: 'press',
      chord: { source: 'keyboard', key: 'A', modifiers: ['Meta'] },
    })
  })
})

function event(phase: 'down' | 'up', timestamp: number): ShortcutRecordEvent {
  return {
    phase,
    timestamp,
    chord: { source: 'keyboard', key: 'V', modifiers: [] },
  }
}

function modifierEvent(
  phase: 'down' | 'up',
  key: 'Meta' | 'Alt',
  modifiers: Array<'Meta' | 'Alt'>,
  timestamp: number,
): ShortcutRecordEvent {
  return {
    phase,
    timestamp,
    chord: { source: 'keyboard', key, modifiers },
  }
}

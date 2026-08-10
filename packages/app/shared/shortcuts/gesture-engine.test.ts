import type { ShortcutBinding, ShortcutRecordEvent } from './types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createShortcutGestureEngine } from './gesture-engine'

describe('快捷键手势引擎生命周期', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('输入源消失时通过释放事件取消进行中的长按', async () => {
    vi.useFakeTimers()
    const events: Array<{ phase: string, gesture: string }> = []
    const binding = createHoldBinding()
    const engine = createShortcutGestureEngine({
      entries: [{ id: 'voiceDictation', binding }],
      emit: ({ phase, gesture }) => events.push({ phase, gesture }),
    })

    engine.handle(createRecordEvent('down', binding))
    await vi.advanceTimersByTimeAsync(300)

    expect(events).toEqual([{ phase: 'trigger', gesture: 'hold' }])

    engine.cancelActiveGestures()
    engine.cancelActiveGestures()

    expect(events).toEqual([
      { phase: 'trigger', gesture: 'hold' },
      { phase: 'release', gesture: 'hold' },
    ])
  })

  it('渲染进程卸载前销毁引擎会释放已经触发的长按', async () => {
    vi.useFakeTimers()
    const release = vi.fn()
    const binding = createHoldBinding()
    const engine = createShortcutGestureEngine({
      entries: [{ id: 'voiceDictation', binding }],
      emit: event => release(event.phase),
    })

    engine.handle(createRecordEvent('down', binding))
    await vi.advanceTimersByTimeAsync(300)
    engine.dispose()
    engine.dispose()

    expect(release).toHaveBeenNthCalledWith(1, 'trigger')
    expect(release).toHaveBeenNthCalledWith(2, 'release')
    expect(release).toHaveBeenCalledTimes(2)
  })

  it('完整按压结束后才触发 press，使上层能在组合键开始时取消父 chord', () => {
    const events: string[] = []
    const binding = createFnBinding('Fn', 'press')
    const engine = createShortcutGestureEngine({
      entries: [{ id: 'fnPress', binding }],
      emit: event => events.push(`${event.phase}:${event.gesture}`),
    })

    engine.handle(createRecordEvent('down', binding))
    engine.cancelChord(binding.chord)
    engine.handle(createRecordEvent('up', binding))

    expect(events).toEqual([])
  })

  it('press 与 doublePress 共用 chord 时延迟单击，并在双击成立后取消它', async () => {
    vi.useFakeTimers()
    const events: string[] = []
    const press = createFnBinding('Fn', 'press')
    const doublePress = createFnBinding('Fn', 'doublePress')
    const engine = createShortcutGestureEngine({
      entries: [
        { id: 'press', binding: press },
        { id: 'double', binding: doublePress },
      ],
      emit: event => events.push(`${event.id}:${event.gesture}`),
    })

    engine.handle(createRecordEvent('down', press))
    engine.handle(createRecordEvent('up', press))
    await vi.advanceTimersByTimeAsync(100)
    engine.handle(createRecordEvent('down', press))
    engine.handle(createRecordEvent('up', press))
    await vi.advanceTimersByTimeAsync(300)

    expect(events).toEqual(['double:doublePress'])
  })

  it('暂停后不触发仍在等待双击窗口的 press', async () => {
    vi.useFakeTimers()
    let paused = false
    const emit = vi.fn()
    const press = createFnBinding('Fn', 'press')
    const doublePress = createFnBinding('Fn', 'doublePress')
    const engine = createShortcutGestureEngine({
      entries: [
        { id: 'press', binding: press },
        { id: 'double', binding: doublePress },
      ],
      isPaused: () => paused,
      emit,
    })

    engine.handle(createRecordEvent('down', press))
    engine.handle(createRecordEvent('up', press))
    paused = true
    await vi.advanceTimersByTimeAsync(300)

    expect(emit).not.toHaveBeenCalled()
  })

  it('所有候选都被 canStart 拒绝时不报告已处理', () => {
    const binding = createFnBinding('Fn', 'press')
    const engine = createShortcutGestureEngine({
      entries: [{ id: 'press', binding, canStart: () => false }],
      emit: vi.fn(),
    })

    expect(engine.handle(createRecordEvent('down', binding))).toBe(false)
  })
})

function createHoldBinding(): ShortcutBinding {
  return {
    scope: 'local',
    gesture: 'hold',
    chord: {
      source: 'keyboard',
      key: 'V',
      modifiers: [],
    },
  }
}

function createRecordEvent(
  phase: ShortcutRecordEvent['phase'],
  binding: ShortcutBinding,
): ShortcutRecordEvent {
  return {
    phase,
    chord: binding.chord,
    timestamp: 0,
  }
}

function createFnBinding(
  key: 'Fn',
  gesture: ShortcutBinding['gesture'],
): ShortcutBinding {
  return {
    scope: 'global',
    gesture,
    chord: { source: 'fn', key },
  }
}

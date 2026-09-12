/**
 * 系统级输入 runtime backend：Fn 与全局 keyboard 绑定共用一条输入流时的手势裁决边界
 *
 * 用例来自两段真实回归：修饰键侧别（右 Option 绑定被左 Option 触发、hold 期间另一侧
 * 加入没有释放）和 Fn 组合（Fn+Space 同时触发裸 Fn、helper reset 后 hold 永不释放）
 */
import type { KeyboardInput, KeyboardInputEvent, ShortcutBinding, ShortcutBindings } from '@shared/shortcuts'
import type { ShortcutRuntimeBackendContext } from './runtime-backend'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resumeShortcutRuntime, suspendShortcutRuntime } from './suspension'

const harness = vi.hoisted(() => ({
  listener: null as ((input: KeyboardInput) => void) | null,
  acquire: vi.fn(),
  release: vi.fn(),
}))

vi.mock('./input', () => ({
  keyboardInputBackend: {
    id: 'uiohook',
    isAvailable: () => true,
    acquire: harness.acquire,
    release: harness.release,
    sync: vi.fn(),
    shutdown: vi.fn(),
    subscribe: (listener: (input: KeyboardInput) => void) => {
      harness.listener = listener
      return () => {
        harness.listener = null
      }
    },
  },
}))
vi.mock('../logging', () => ({
  createMainDiagnosticLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

const { systemInputShortcutRuntimeBackend } = await import('./input-runtime-backend')

describe('系统级输入 runtime backend', () => {
  const emitted: Array<{ id: string, phase: string, gesture: string }> = []
  let canTrigger = true

  beforeEach(() => {
    resumeShortcutRuntime()
    emitted.length = 0
    canTrigger = true
    harness.acquire.mockReset()
    harness.release.mockReset()
  })

  afterEach(() => {
    systemInputShortcutRuntimeBackend.reset()
    resumeShortcutRuntime()
    vi.useRealTimers()
  })

  function apply(bindings: ShortcutBindings): void {
    const context: ShortcutRuntimeBackendContext = {
      getHandler: () => vi.fn(),
      canTrigger: () => canTrigger,
      emit: event => emitted.push({ id: event.id, phase: event.phase, gesture: event.gesture }),
    }
    systemInputShortcutRuntimeBackend.apply(bindings, context)
  }

  it('重载期间释放已经触发的 hold，并归还捕获后端引用', async () => {
    vi.useFakeTimers()
    apply({ voiceDictation: keyboard('hold', 'V') })

    send('down', 'V')
    await vi.advanceTimersByTimeAsync(300)
    systemInputShortcutRuntimeBackend.reset()

    expect(emitted).toEqual([
      { id: 'voiceDictation', phase: 'trigger', gesture: 'hold' },
      { id: 'voiceDictation', phase: 'release', gesture: 'hold' },
    ])
    expect(harness.release).toHaveBeenCalledOnce()
  })

  it('进入 suspension 时立即释放 active hold，且保留输入订阅与后端引用', async () => {
    vi.useFakeTimers()
    apply({ voiceDictation: keyboard('hold', 'V') })

    send('down', 'V')
    await vi.advanceTimersByTimeAsync(300)
    suspendShortcutRuntime()

    expect(emitted.map(event => event.phase)).toEqual(['trigger', 'release'])
    expect(harness.listener).not.toBeNull()
    expect(harness.release).not.toHaveBeenCalled()
  })

  it('修饰键自身的状态不会被当成额外 modifier 拒绝', async () => {
    vi.useFakeTimers()
    apply({ voiceDictation: keyboard('hold', 'MetaLeft') })

    send('down', 'MetaLeft', ['Meta'])
    await vi.advanceTimersByTimeAsync(300)
    send('up', 'MetaLeft')

    expect(emitted.map(event => event.phase)).toEqual(['trigger', 'release'])
  })

  it('右侧修饰键绑定不会被左侧同名修饰键触发', () => {
    apply({ voiceDictation: keyboard('press', 'AltRight') })

    send('down', 'AltLeft', ['Alt'])
    send('up', 'AltLeft')
    expect(emitted).toEqual([])

    send('down', 'AltRight', ['Alt'])
    send('up', 'AltRight')
    expect(emitted).toEqual([{ id: 'voiceDictation', phase: 'trigger', gesture: 'press' }])
  })

  it('普通主键组合精确匹配修饰键侧别', () => {
    apply({ recording: keyboard('press', 'A', ['AltRight']) })

    send('down', 'AltLeft', ['Alt'])
    send('down', 'A', ['Alt'])
    send('up', 'A', ['Alt'])
    send('up', 'AltLeft')
    expect(emitted).toEqual([])

    send('down', 'AltRight', ['Alt'])
    send('down', 'A', ['Alt'])
    send('up', 'A', ['Alt'])
    send('up', 'AltRight')
    expect(emitted).toHaveLength(1)
  })

  it('声明式逻辑修饰键允许同一家族左右两侧同时按下', () => {
    apply({ recording: keyboard('press', 'A', ['Alt']) })

    send('down', 'AltLeft', ['Alt'])
    send('down', 'AltRight', ['Alt'])
    send('down', 'A', ['Alt'])
    send('up', 'A', ['Alt'])

    expect(emitted).toHaveLength(1)
  })

  it('物理右 Option 绑定拒绝同时按住左 Option', () => {
    apply({ recording: keyboard('press', 'A', ['AltRight']) })

    send('down', 'AltLeft', ['Alt'])
    send('down', 'AltRight', ['Alt'])
    send('down', 'A', ['Alt'])
    send('up', 'A', ['Alt'])

    expect(emitted).toEqual([])
  })

  it('多个修饰键组合要求除主键外的 modifier 精确匹配', () => {
    apply({ recording: keyboard('press', 'MetaLeft', ['AltRight']) })

    send('down', 'MetaLeft', ['Meta'])
    send('down', 'AltRight', ['Alt', 'Meta'])
    send('up', 'AltRight', ['Meta'])

    expect(emitted).toEqual([{ id: 'recording', phase: 'trigger', gesture: 'press' }])
  })

  it('组合键开始时撤销单修饰键 hold 候选', async () => {
    vi.useFakeTimers()
    apply({
      voiceDictation: keyboard('hold', 'MetaLeft'),
      recording: keyboard('hold', 'MetaLeft', ['AltRight']),
    })

    send('down', 'MetaLeft', ['Meta'])
    send('down', 'AltRight', ['Alt', 'Meta'])
    await vi.advanceTimersByTimeAsync(300)

    expect(emitted).toEqual([{ id: 'recording', phase: 'trigger', gesture: 'hold' }])
  })

  it('hold 生效后新增同家族另一侧 modifier 会立即释放', async () => {
    vi.useFakeTimers()
    apply({ recording: keyboard('hold', 'A', ['AltRight']) })

    send('down', 'AltRight', ['Alt'])
    send('down', 'A', ['Alt'])
    await vi.advanceTimersByTimeAsync(300)
    send('down', 'AltLeft', ['Alt'])

    expect(emitted.map(event => event.phase)).toEqual(['trigger', 'release'])
  })

  it('普通主键仍按住时松开 modifier 会立即释放 hold', async () => {
    vi.useFakeTimers()
    apply({ recording: keyboard('hold', 'A', ['AltRight']) })

    send('down', 'AltRight', ['Alt'])
    send('down', 'A', ['Alt'])
    await vi.advanceTimersByTimeAsync(300)
    send('up', 'AltRight')

    expect(emitted.map(event => event.phase)).toEqual(['trigger', 'release'])
  })

  it('Fn 组合 hold 在触发后即便不再允许触发也会释放', async () => {
    vi.useFakeTimers()
    apply({ voiceDictation: fn('hold', 'Space') })

    send('down', 'Fn')
    send('down', 'Space', [], true)
    await vi.advanceTimersByTimeAsync(300)
    canTrigger = false
    send('up', 'Space', [], true)

    expect(emitted.map(event => event.phase)).toEqual(['trigger', 'release'])
  })

  it('Fn 组合开始时撤销裸 Fn 候选，只触发组合', async () => {
    vi.useFakeTimers()
    apply({
      voiceDictation: fn('hold', 'Fn'),
      recording: fn('press', 'Space'),
    })

    send('down', 'Fn')
    send('down', 'Space', [], true)
    await vi.advanceTimersByTimeAsync(300)
    send('up', 'Space', [], true)
    send('up', 'Fn')

    expect(emitted).toEqual([{ id: 'recording', phase: 'trigger', gesture: 'press' }])
  })

  it('fn + 修饰键只触发该组合，不论按下顺序都撤销裸候选', async () => {
    vi.useFakeTimers()
    apply({
      voiceDictation: fn('press', 'Fn'),
      bookmark: keyboard('press', 'MetaLeft'),
      recording: {
        scope: 'global',
        gesture: 'press',
        chord: { source: 'fn', key: 'Fn', modifiers: ['Meta'] },
      },
    })

    send('down', 'Fn')
    send('down', 'MetaLeft', ['Meta'], true)
    send('up', 'MetaLeft', [], true)
    send('up', 'Fn')
    await vi.advanceTimersByTimeAsync(300)

    send('down', 'MetaLeft', ['Meta'])
    send('down', 'Fn')
    send('up', 'Fn')
    send('up', 'MetaLeft')
    await vi.advanceTimersByTimeAsync(300)

    expect(emitted).toEqual([
      { id: 'recording', phase: 'trigger', gesture: 'press' },
      { id: 'recording', phase: 'trigger', gesture: 'press' },
    ])
  })

  it('方向键组合按一个 chord 触发，单独的方向键不触发它', () => {
    apply({
      recording: {
        scope: 'global',
        gesture: 'press',
        chord: {
          source: 'keyboard',
          key: 'ArrowUp',
          modifiers: [],
          keys: ['ArrowLeft'],
        },
      },
    })

    send('down', 'ArrowUp')
    send('up', 'ArrowUp')
    send('down', 'ArrowLeft')
    send('down', 'ArrowUp')
    send('up', 'ArrowLeft')
    send('up', 'ArrowUp')

    expect(emitted).toEqual([{ id: 'recording', phase: 'trigger', gesture: 'press' }])
  })

  it('捕获后端 reset 会释放 active hold', async () => {
    vi.useFakeTimers()
    apply({ voiceDictation: { ...fn('hold', 'Fn'), scope: 'local' } })

    send('down', 'Fn')
    await vi.advanceTimersByTimeAsync(300)
    canTrigger = false
    harness.listener?.({ phase: 'reset', timestamp: 300 })
    harness.listener?.({ phase: 'reset', timestamp: 301 })

    expect(emitted.map(event => event.phase)).toEqual(['trigger', 'release'])
  })

  it('捕获后端拒绝 acquire 时不留下订阅', () => {
    harness.acquire.mockImplementation(() => {
      throw new Error('denied')
    })

    apply({ recording: keyboard('press', 'A', ['Alt']) })

    expect(harness.listener).toBeNull()
    expect(harness.release).not.toHaveBeenCalled()
  })

  it('降级到窗口内的 keyboard 绑定不在这里注册', () => {
    apply({ recording: { ...keyboard('press', 'A', ['Alt']), scope: 'local' } })

    expect(harness.acquire).not.toHaveBeenCalled()
    expect(harness.listener).toBeNull()
  })
})

function send(
  phase: 'down' | 'up',
  key: KeyboardInputEvent['key'],
  modifiers: KeyboardInputEvent['modifiers'] = [],
  fnHeld = false,
): void {
  harness.listener?.({ phase, key, modifiers, fn: fnHeld, timestamp: Date.now() })
}

function keyboard(
  gesture: ShortcutBinding['gesture'],
  key: Extract<ShortcutBinding['chord'], { source: 'keyboard' }>['key'],
  modifiers: Extract<ShortcutBinding['chord'], { source: 'keyboard' }>['modifiers'] = [],
): ShortcutBinding {
  return { scope: 'global', gesture, chord: { source: 'keyboard', key, modifiers } }
}

function fn(
  gesture: ShortcutBinding['gesture'],
  key: Extract<ShortcutBinding['chord'], { source: 'fn' }>['key'],
): ShortcutBinding {
  return { scope: 'global', gesture, chord: { source: 'fn', key } }
}

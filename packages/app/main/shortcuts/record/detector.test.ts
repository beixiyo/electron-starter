/**
 * 录制捕获：统一输入流下的侧别保留、Fn 组合合成与捕获归属
 *
 * 守的是三件会直接毁掉录制结果的事：修饰键丢掉左右侧别（录出来的绑定永远匹配不上）、
 * Fn 组合被录成两条互相冲突的 chord、以及捕获后端不可用时仍占着引用计数不放
 */
import type { KeyboardInput, KeyboardInputEvent, ShortcutRecordEvent } from '@shared/shortcuts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  available: true,
  listener: null as ((input: KeyboardInput) => void) | null,
  acquire: vi.fn(),
  release: vi.fn(),
}))

vi.mock('../input', () => ({
  keyboardInputBackend: {
    id: 'native-mac',
    isAvailable: () => harness.available,
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

const { startRecordShortcutDetection, stopRecordShortcutDetection } = await import('./detector')

describe('全局快捷键录制', () => {
  const events: ShortcutRecordEvent[] = []
  const onReset = vi.fn()

  beforeEach(() => {
    harness.available = true
    harness.acquire.mockReset()
    harness.release.mockReset()
    onReset.mockReset()
    events.length = 0
  })

  afterEach(() => {
    stopRecordShortcutDetection()
  })

  function send(
    phase: 'down' | 'up',
    key: KeyboardInputEvent['key'],
    modifiers: Array<'Alt' | 'Meta'> = [],
    fnHeld = false,
  ): void {
    harness.listener?.({ phase, key, modifiers, fn: fnHeld, timestamp: 1 })
  }

  it('主进程接管后保留物理侧别，modifier 先松开时结束完整 chord', () => {
    expect(startRecordShortcutDetection({ emit: event => events.push(event), onReset })).toBe(true)

    send('down', 'AltRight', ['Alt'])
    send('down', 'A', ['Alt'])
    send('up', 'AltRight')
    send('up', 'A')
    send('down', 'B')

    expect(events.map(event => `${event.phase}:${event.chord.key}:${(event.chord.modifiers ?? []).join('+')}`)).toEqual([
      'down:AltRight:',
      'down:A:AltRight',
      'up:A:AltRight',
      'up:AltRight:',
      'up:A:',
      'down:B:',
    ])
  })

  it('Fn 组合与普通键盘来自同一条流，reset 转发给调用方', () => {
    startRecordShortcutDetection({ emit: event => events.push(event), onReset })

    send('down', 'Fn')
    send('down', 'Space', ['Meta'], true)
    harness.listener?.({ phase: 'reset', timestamp: 2 })

    expect(events.map(event => event.chord)).toEqual([
      { source: 'fn', key: 'Fn' },
      { source: 'fn', key: 'Space', modifiers: ['Meta'] },
    ])
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('捕获后端不可用时报告未接管，并且不占用引用', () => {
    harness.available = false

    expect(startRecordShortcutDetection({ emit: event => events.push(event) })).toBe(false)
    expect(harness.acquire).not.toHaveBeenCalled()
    expect(harness.listener).toBeNull()

    stopRecordShortcutDetection()
    expect(harness.release).not.toHaveBeenCalled()
  })

  it('停止后归还引用且可重复调用', () => {
    startRecordShortcutDetection({ emit: event => events.push(event) })
    stopRecordShortcutDetection()
    stopRecordShortcutDetection()

    expect(harness.release).toHaveBeenCalledOnce()
    expect(harness.listener).toBeNull()
  })
})

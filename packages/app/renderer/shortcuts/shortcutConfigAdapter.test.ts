// @vitest-environment jsdom
/** 录制会话的事件归属、重置传递与持久化失败契约 */
import type { ShortcutRecordEvent } from '@shared/shortcuts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindShortcutRecordEvents, setShortcutBindings } from './shortcutConfigAdapter'

const environment = vi.hoisted(() => ({ electron: false }))
vi.mock('@/utils/env', () => ({ isElectron: () => environment.electron }))

afterEach(() => {
  environment.electron = false
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('录制事件来源', () => {
  it('原生接管时 DOM 只吞键，IPC 事件不延迟且 reset 能清空录制', () => {
    environment.electron = true
    const listeners = new Map<string, (event?: ShortcutRecordEvent) => void>()
    const on = vi.fn((name: string, listener: (event?: ShortcutRecordEvent) => void) => {
      listeners.set(name, listener)
      return () => listeners.delete(name)
    })
    vi.stubGlobal('$ipc', { shortcutConfig: { on } } as unknown as Window['$ipc'])
    const emit = vi.fn()
    const onReset = vi.fn()
    const unbind = bindShortcutRecordEvents({ nativeCapture: true, emit, onReset })
    const key = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', cancelable: true })
    window.dispatchEvent(key)
    expect(key.defaultPrevented).toBe(true)
    expect(emit).not.toHaveBeenCalled()

    const record: ShortcutRecordEvent = { phase: 'down', chord: { source: 'fn', key: 'Fn' }, timestamp: 1 }
    listeners.get('record')?.(record)
    listeners.get('recordReset')?.()
    expect(emit).toHaveBeenCalledExactlyOnceWith(record)
    expect(onReset).toHaveBeenCalledOnce()
    unbind()
    expect(listeners.size).toBe(0)
  })

  it('DOM 回退把 Esc 送进校验，并吞掉重复 keydown 的默认行为', () => {
    const emit = vi.fn()
    const unbind = bindShortcutRecordEvents({ nativeCapture: false, emit, onReset: vi.fn() })
    const down = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', cancelable: true })
    const repeat = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', repeat: true, cancelable: true })
    window.dispatchEvent(down)
    window.dispatchEvent(repeat)
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape' }))
    expect(down.defaultPrevented).toBe(true)
    expect(repeat.defaultPrevented).toBe(true)
    expect(emit.mock.calls.map(([event]) => [event.phase, event.chord.key])).toEqual([
      ['down', 'Escape'], ['up', 'Escape'],
    ])
    unbind()
  })

  it('Web 写入失败向调用方抛出，不能伪装保存成功', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable') })
    await expect(setShortcutBindings({})).rejects.toThrow('storage unavailable')
  })
})

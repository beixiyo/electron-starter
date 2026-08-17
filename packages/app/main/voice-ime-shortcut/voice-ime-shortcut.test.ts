import type { ShortcutRuntimeEvent } from '@shared/shortcuts'
import { describe, expect, it, vi } from 'vitest'
import { createVoiceImeShortcutController } from '.'

describe('Voice IME 快捷键策略', () => {
  it('hold 在 trigger 开始，并在 release 结束', () => {
    const start = vi.fn(async () => {})
    const stop = vi.fn()
    const controller = createVoiceImeShortcutController({
      start,
      stop,
      isRecording: () => false,
    })

    controller.handle(event('trigger', 'hold'), 'hold')
    controller.handle(event('release', 'hold'), 'hold')

    expect(start).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledWith('hold')
  })

  it('toggle 第一次 trigger 开始，录制中再次 trigger 结束', () => {
    let recording = false
    const start = vi.fn(async () => {
      recording = true
    })
    const stop = vi.fn(() => {
      recording = false
    })
    const controller = createVoiceImeShortcutController({
      start,
      stop,
      isRecording: () => recording,
    })

    controller.handle(event('trigger', 'press'), 'toggle')
    controller.handle(event('trigger', 'press'), 'toggle')

    expect(start).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledWith('toggle')
  })

  it('再次触发会取消尚未通过异步门禁的 toggle 启动', () => {
    let shouldContinue: (() => boolean) | undefined
    const start = vi.fn(async (nextShouldContinue: () => boolean) => {
      shouldContinue = nextShouldContinue
    })
    const controller = createVoiceImeShortcutController({
      start,
      stop: vi.fn(),
      isRecording: () => false,
    })

    controller.handle(event('trigger', 'press'), 'toggle')
    expect(shouldContinue?.()).toBe(true)

    controller.handle(event('trigger', 'press'), 'toggle')
    expect(shouldContinue?.()).toBe(false)
  })
})

function event(
  phase: ShortcutRuntimeEvent['phase'],
  gesture: ShortcutRuntimeEvent['gesture'],
): ShortcutRuntimeEvent {
  return {
    id: 'voiceDictation',
    phase,
    gesture,
    binding: {
      scope: 'global',
      gesture,
      chord: { source: 'fn', key: 'Fn' },
    },
  }
}

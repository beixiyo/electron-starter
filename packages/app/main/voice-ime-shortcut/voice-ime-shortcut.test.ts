import type { ShortcutRuntimeEvent } from '@shared/shortcuts'
import { describe, expect, it, vi } from 'vitest'
import { createVoiceImeShortcutController } from '.'

describe('Voice IME 快捷键策略', () => {
  it('hold 松开只结束本次按压启动的会话', async () => {
    const start = vi.fn(async () => 'original-session')
    const stop = vi.fn()
    const controller = createVoiceImeShortcutController({ start, stop, isRecording: () => false })
    controller.handle(event('trigger', 'hold'), 'hold')
    await Promise.resolve()
    controller.handle(event('release', 'hold'), 'hold')
    expect(start).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledWith('original-session')
  })

  it('电源清理后迟到的 hold release 不终止后来从点击入口开始的会话', async () => {
    const stop = vi.fn()
    const controller = createVoiceImeShortcutController({ start: async () => 'old-session', stop, isRecording: () => true })
    controller.handle(event('trigger', 'hold'), 'hold')
    await Promise.resolve()
    controller.cancelPendingStart()
    controller.handle(event('release', 'hold'), 'hold')
    expect(stop).not.toHaveBeenCalled()
  })

  it('toggle 第一次 trigger 开始，录制中再次 trigger 结束', () => {
    let recording = false
    const start = vi.fn(async () => {
      recording = true
      return 'toggle-session'
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
    expect(stop).toHaveBeenCalledOnce()
  })

  it('再次触发会取消尚未通过异步门禁的 toggle 启动', () => {
    let shouldContinue: (() => boolean) | undefined
    const start = vi.fn(async ({ shouldContinue: nextShouldContinue }: { shouldContinue: () => boolean }) => {
      shouldContinue = nextShouldContinue
      return null
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

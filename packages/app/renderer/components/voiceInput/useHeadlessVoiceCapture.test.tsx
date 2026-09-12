// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useHeadlessVoiceCapture } from './useHeadlessVoiceCapture'
import type { VoiceCaptureAdapter } from './types'

function createCapture(): VoiceCaptureAdapter & { events: string[] } {
  const events: string[] = []
  return {
    events,
    start: async ({ sessionId }) => { events.push(`start:${sessionId}`) },
    stop: async ({ sessionId }) => {
      events.push(`stop:${sessionId}`)
      return new Blob([sessionId], { type: 'audio/webm' })
    },
    cancel: async ({ sessionId }) => { events.push(`cancel:${sessionId}`) },
  }
}

describe('useHeadlessVoiceCapture', () => {
  it('串行执行 start/stop，并把转写结果交给当前会话', async () => {
    const capture = createCapture()
    const onResult = vi.fn()
    const { result } = renderHook(() => useHeadlessVoiceCapture({
      capture,
      transcribe: async (audio, { sessionId }) => `${sessionId}:${await audio.text()}`,
      onResult,
    }))

    await act(async () => {
      await result.current.start()
      await result.current.stop()
    })

    expect(capture.events).toEqual(['start:1', 'stop:1'])
    expect(onResult).toHaveBeenCalledWith('1:1', '1')
    expect(result.current.phase).toBe('result')
  })

  it('旧转写不响应取消时，新一轮仍能开始，迟到结果不会回写', async () => {
    const capture = createCapture()
    let resolveTranscribe!: (text: string) => void
    const onResult = vi.fn()
    const { result, unmount } = renderHook(() => useHeadlessVoiceCapture({
      capture,
      transcribe: () => new Promise(resolve => { resolveTranscribe = resolve }),
      onResult,
    }))

    await act(async () => { await result.current.start() })
    let stopPromise!: Promise<string | null>
    act(() => { stopPromise = result.current.stop() })
    await waitFor(() => expect(resolveTranscribe).toBeTypeOf('function'))
    await act(async () => { await result.current.cancel() })
    act(() => result.current.reset())
    let nextStart!: Promise<string | null>
    act(() => { nextStart = result.current.start() })
    try {
      await waitFor(() => expect(capture.events.filter(event => event.startsWith('start:'))).toHaveLength(2), { timeout: 300 })
      expect(result.current.phase).toBe('recording')
    }
    finally {
      resolveTranscribe('stale')
      await act(async () => { await stopPromise; await nextStart })
      expect(onResult).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('开始后更换适配器，仍由原驱动停止并用原转写器处理，卸载释放两个驱动', async () => {
    const first = { ...createCapture(), destroy: vi.fn() }
    const second = { ...createCapture(), destroy: vi.fn() }
    const transcribeFirst = vi.fn(async () => 'first result')
    const transcribeSecond = vi.fn(async () => 'second result')
    const onResult = vi.fn()
    const { result, rerender, unmount } = renderHook(({ capture, transcribe }) => useHeadlessVoiceCapture({ capture, transcribe, onResult }), {
      initialProps: { capture: first, transcribe: transcribeFirst },
    })
    await act(async () => { await result.current.start() })
    rerender({ capture: second, transcribe: transcribeSecond })
    await act(async () => { await result.current.stop() })
    expect(first.events).toEqual(['start:1', 'stop:1'])
    expect(second.events).toEqual([])
    expect(transcribeFirst).toHaveBeenCalledOnce()
    expect(transcribeSecond).not.toHaveBeenCalled()
    expect(onResult).toHaveBeenCalledWith('first result', '1')
    unmount()
    expect(first.destroy).toHaveBeenCalledOnce()
    expect(second.destroy).toHaveBeenCalledOnce()
  })
  it('卸载时仍在申请的采集资源，迟到创建后也会被原驱动释放', async () => {
    let releaseStart!: () => void
    let acquired = false
    let entered = false
    const permission = new Promise<void>(resolve => { releaseStart = resolve })
    const capture: VoiceCaptureAdapter = {
      start: async () => { entered = true; await permission; acquired = true },
      stop: async () => new Blob(),
      cancel: () => { acquired = false },
      destroy: () => { acquired = false },
    }
    const { result, unmount } = renderHook(() => useHeadlessVoiceCapture({ capture }))
    let pending!: Promise<string | null>
    act(() => { pending = result.current.start() })
    await waitFor(() => expect(entered).toBe(true))
    unmount()
    releaseStart()
    await pending
    expect(acquired).toBe(false)
  })

  it('取消封存音频后撤销使用同一份 Blob，不重新打开麦克风，也不交付迟到转写', async () => {
    const audio = new Blob(['captured audio'])
    const capture = { start: vi.fn(), stop: vi.fn(async () => audio), cancel: vi.fn() }
    let finishOld!: (text: string) => void
    const transcribe = vi.fn()
      .mockImplementationOnce(() => new Promise<string>(resolve => { finishOld = resolve }))
      .mockResolvedValueOnce('restored text')
    const onResult = vi.fn()
    const { result } = renderHook(() => useHeadlessVoiceCapture({ capture, transcribe, onResult }))
    await act(async () => { await result.current.start({ sessionId: 'main-session' }) })
    let old!: Promise<string | null>
    act(() => { old = result.current.stop() })
    await waitFor(() => expect(transcribe).toHaveBeenCalledOnce())
    await act(async () => { expect(await result.current.retain()).toBe(true) })
    await act(async () => { await result.current.resume() })
    finishOld('stale text')
    await act(async () => { await old })
    expect(capture.start).toHaveBeenCalledOnce()
    expect(capture.stop).toHaveBeenCalledOnce()
    expect(transcribe.mock.calls.map(call => call[0])).toEqual([audio, audio])
    expect(onResult).toHaveBeenCalledExactlyOnceWith('restored text', 'main-session')
  })

  it('仅实现 cancel 的驱动在宿主卸载时也会释放正在采集的资源', async () => {
    let recording = false
    const capture: VoiceCaptureAdapter = {
      start: () => { recording = true },
      stop: () => new Blob(),
      cancel: () => { recording = false },
    }
    const { result, unmount } = renderHook(() => useHeadlessVoiceCapture({ capture }))
    await act(async () => { await result.current.start() })
    expect(recording).toBe(true)
    unmount()
    expect(recording).toBe(false)
  })

})

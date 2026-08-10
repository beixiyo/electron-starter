import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordingStateManager } from './recording-state'

describe('native 录音就绪握手', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('helper ready 前保持 starting 且不计入录音时长', async () => {
    vi.useFakeTimers()
    const state = new RecordingStateManager()

    expect(state.startManualNative()).toMatchObject({
      phase: 'starting',
      elapsed: 0,
      nativeSource: 'manual',
    })

    await vi.advanceTimersByTimeAsync(2_000)
    expect(state.snapshot).toMatchObject({ phase: 'starting', elapsed: 0 })

    expect(state.confirmNativeStarted()).toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(state.snapshot).toMatchObject({ phase: 'recording', elapsed: 1 })

    state.reset()
  })

  it('启动期间取消后拒绝迟到的 ready 回执', () => {
    const state = new RecordingStateManager()

    state.startManualNative()
    state.reset()

    expect(state.confirmNativeStarted()).toBe(false)
    expect(state.snapshot).toEqual({ phase: 'idle', elapsed: 0 })
  })
})

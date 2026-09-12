// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVoiceUndoWindow } from './useVoiceUndoWindow'

afterEach(() => vi.useRealTimers())

describe('useVoiceUndoWindow', () => {
  it('旧窗口到期回调不会释放新一轮撤销内容', () => {
    vi.useFakeTimers()
    const onExpire = vi.fn()
    const { result } = renderHook(() => useVoiceUndoWindow<string>({ windowMs: 5000, onExpire }))

    act(() => result.current.open('first'))
    act(() => {
      vi.advanceTimersByTime(1000)
      result.current.open('second')
    })
    act(() => vi.advanceTimersByTime(4000))

    expect(result.current.isPending).toBe(true)
    expect(result.current.consume()).toBe('second')
    expect(onExpire).not.toHaveBeenCalled()
  })

  it('窗口到期后消费返回空并清理可见状态', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useVoiceUndoWindow<string>({ windowMs: 5000 }))

    act(() => result.current.open('audio'))
    act(() => vi.advanceTimersByTime(5000))

    expect(result.current.isPending).toBe(false)
    expect(result.current.expiresAt).toBeNull()
    expect(result.current.consume()).toBeNull()
  })
})

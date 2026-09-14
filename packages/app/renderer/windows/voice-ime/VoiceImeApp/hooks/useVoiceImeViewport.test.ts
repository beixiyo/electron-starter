// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useVoiceImeViewport } from './useVoiceImeViewport'

describe('useVoiceImeViewport', () => {
  it('drops a stale state width and animates the fallback and measured sizes', () => {
    const runtime = {
      resizeTo: vi.fn(),
      hide: vi.fn(),
    }
    const { result } = renderHook(() => useVoiceImeViewport({ runtime }))

    expect(runtime.resizeTo).toHaveBeenCalledWith(380, 112, false)

    act(() => {
      result.current.switchView('recording')
    })

    expect(result.current.size).toEqual({ width: 260, height: 100 })
    expect(runtime.resizeTo).toHaveBeenLastCalledWith(260, 100, true)

    act(() => {
      result.current.reportContentWidth(480, 'prompt')
    })

    expect(result.current.size).toEqual({ width: 260, height: 100 })

    act(() => {
      result.current.reportContentWidth(156, 'recording')
    })

    expect(result.current.size).toEqual({ width: 216, height: 100 })
    expect(runtime.resizeTo).toHaveBeenLastCalledWith(216, 100, true)
  })
})

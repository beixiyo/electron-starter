// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useVoiceImeViewport } from './useVoiceImeViewport'

function createRuntime() {
  let hiddenListener: (() => void) | null = null
  return {
    runtime: {
      reportShell: vi.fn(),
      hide: vi.fn(),
      onHidden: vi.fn((listener: () => void) => {
        hiddenListener = listener
        return () => {
          hiddenListener = null
        }
      }),
    },
    emitHidden: () => hiddenListener?.(),
  }
}

describe('useVoiceImeViewport', () => {
  it('drops a stale state width, sizes the shell from the measured width and reports it', () => {
    const { runtime } = createRuntime()
    const { result } = renderHook(() => useVoiceImeViewport({ runtime }))

    /** 窗口固定尺寸，挂载只上报壳的目标度量，不会有任何 resize；静息态就是胶囊 */
    expect(result.current.viewMode).toBe('recording')
    expect(result.current.size).toEqual({ width: 200, height: 100 })
    expect(runtime.reportShell).toHaveBeenLastCalledWith({ width: 140, height: 40 })

    act(() => {
      result.current.reportContentWidth(480, 'prompt')
    })

    expect(result.current.size).toEqual({ width: 200, height: 100 })

    act(() => {
      result.current.reportContentWidth(156, 'recording')
    })

    expect(result.current.size).toEqual({ width: 216, height: 100 })
    expect(runtime.reportShell).toHaveBeenLastCalledWith({ width: 156, height: 40 })
  })

  it('remounts the surface as the initial view when the host window gets hidden', async () => {
    const { runtime, emitHidden } = createRuntime()
    const { result } = renderHook(() => useVoiceImeViewport({ runtime }))

    act(() => {
      result.current.switchView('result')
    })
    expect(result.current.viewMode).toBe('result')
    const before = result.current.mountKey

    /**
     * 隐藏窗口里的动画会被冻住、展示时才接着放；复位必须换代重挂而不是切回去动画过去，
     * 否则下次展示先看到上一张结果卡再缩成胶囊
     */
    act(() => {
      emitHidden()
    })

    expect(result.current.viewMode).toBe('recording')
    expect(result.current.mountKey).toBe(before + 1)

    /** 宿主收窗但页面没进 hidden（如浏览器画布）时，hideAndReset 自己兜底换代 */
    act(() => {
      result.current.switchView('result')
    })
    await act(async () => {
      await result.current.hideAndReset()
    })

    expect(runtime.hide).toHaveBeenCalledTimes(1)
    expect(result.current.viewMode).toBe('recording')
    expect(result.current.mountKey).toBe(before + 2)
  })
})

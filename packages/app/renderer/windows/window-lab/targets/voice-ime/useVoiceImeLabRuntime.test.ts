// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVoiceImeLabRuntime } from './useVoiceImeLabRuntime'

const originalParent = window.parent

afterEach(() => {
  Object.defineProperty(window, 'parent', { configurable: true, value: originalParent })
  delete (window as unknown as { $electron?: unknown }).$electron
  delete (window as unknown as { $ipc?: unknown }).$ipc
})

describe('useVoiceImeLabRuntime', () => {
  it('forwards the animate flag to an isolated native preview', async () => {
    const resizeSelf = vi.fn().mockReturnValue({ success: true })
    Object.assign(window, {
      $electron: { process: { platform: 'darwin' } },
      $ipc: {
        windowLab: {
          openPreview: vi.fn(),
          closePreview: vi.fn(),
          resizeSelf,
        },
      },
    })
    const { result } = renderHook(() => useVoiceImeLabRuntime())

    await result.current.resizeTo(320, 112, true)

    expect(resizeSelf).toHaveBeenCalledWith(320, 112, true)
  })

  it('reports viewport size to the browser canvas', async () => {
    const postMessage = vi.fn()
    Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage } })
    const { result } = renderHook(() => useVoiceImeLabRuntime())

    await result.current.resizeTo(320, 112, false)

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'window-lab:size',
        target: 'voice-ime',
        width: 320,
        height: 112,
      },
      window.location.origin,
    )
  })
})

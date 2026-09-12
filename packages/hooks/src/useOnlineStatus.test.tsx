// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOnlineStatus } from './useOnlineStatus'

afterEach(() => {
  delete (navigator as Navigator & { onLine?: boolean }).onLine
  vi.restoreAllMocks()
})

describe('useOnlineStatus', () => {
  it('reads navigator state and updates from online/offline events', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const { result } = renderHook(() => useOnlineStatus())

    expect(result.current).toBe(false)

    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current).toBe(true)

    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current).toBe(false)
  })

  it('removes both browser listeners on unmount', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useOnlineStatus())

    expect(addEventListener).toHaveBeenCalledWith('online', expect.any(Function))
    expect(addEventListener).toHaveBeenCalledWith('offline', expect.any(Function))

    unmount()

    expect(removeEventListener).toHaveBeenCalledWith('online', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('offline', expect.any(Function))
  })
})

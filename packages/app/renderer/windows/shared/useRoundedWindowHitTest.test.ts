// @vitest-environment jsdom

import { WindowType } from '@shared'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getElementWindowHitTestRegion, useRoundedWindowHitTest } from './useRoundedWindowHitTest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useRoundedWindowHitTest', () => {
  it('disabled mode keeps the whole window receiving events and does not react to mousemove', () => {
    const setIgnoreMouseEvents = vi.fn().mockResolvedValue({ success: true })
    vi.stubGlobal(
      '$ipc',
      {
        window: { setIgnoreMouseEvents },
      } as unknown as Window['$ipc'],
    )

    const { result } = renderHook(() =>
      useRoundedWindowHitTest(
        WindowType.FOCUS_NATIVE,
        [{ x: 0, y: 0, width: 100, height: 100, radius: 0 }],
        { enabled: false },
      )
    )

    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }))
    })

    expect(result.current).toBeUndefined()
    expect(setIgnoreMouseEvents).toHaveBeenCalledTimes(1)
    expect(setIgnoreMouseEvents).toHaveBeenLastCalledWith(WindowType.FOCUS_NATIVE, false)
  })

  it('enabling hit-test switches between rounded regions and click-through state', () => {
    const setIgnoreMouseEvents = vi.fn().mockResolvedValue({ success: true })
    vi.stubGlobal(
      '$ipc',
      {
        window: { setIgnoreMouseEvents },
      } as unknown as Window['$ipc'],
    )

    const element = document.createElement('div')
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 80, 80))
    const { rerender, unmount } = renderHook(
      ({ enabled }) =>
        useRoundedWindowHitTest(
          WindowType.FOCUS_NATIVE,
          () => [getElementWindowHitTestRegion(element, 0)],
          { enabled },
        ),
      { initialProps: { enabled: false } },
    )

    rerender({ enabled: true })
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 20 }))
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200 }))
    })

    expect(setIgnoreMouseEvents).toHaveBeenNthCalledWith(1, WindowType.FOCUS_NATIVE, false)
    expect(setIgnoreMouseEvents).toHaveBeenNthCalledWith(2, WindowType.FOCUS_NATIVE, true, { forward: true })
    expect(setIgnoreMouseEvents).toHaveBeenNthCalledWith(3, WindowType.FOCUS_NATIVE, false, undefined)
    expect(setIgnoreMouseEvents).toHaveBeenNthCalledWith(4, WindowType.FOCUS_NATIVE, true, { forward: true })

    unmount()
    expect(setIgnoreMouseEvents).toHaveBeenNthCalledWith(5, WindowType.FOCUS_NATIVE, false)
  })

  it('reapplies click-through when the target window changes instead of retaining a stale cache', () => {
    const setIgnoreMouseEvents = vi.fn()
    vi.stubGlobal('$ipc', { window: { setIgnoreMouseEvents } })
    const { rerender } = renderHook(({ type }) => useRoundedWindowHitTest(type, []), {
      initialProps: { type: WindowType.FOCUS_NATIVE as WindowType },
    })
    rerender({ type: WindowType.SHORTCUT_TEST })
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200 })) })
    expect(setIgnoreMouseEvents).toHaveBeenLastCalledWith(WindowType.SHORTCUT_TEST, true, { forward: true })
  })
})

// @vitest-environment jsdom

import { WindowType } from '@shared'
import { act, renderHook } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWindowDrag } from './useWindowDrag'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useWindowDrag', () => {
  it('valid drag invokes start callback and sends resolver output to setBounds', async () => {
    const getBounds = vi.fn().mockResolvedValue({ bounds: { x: 10, y: 20 } })
    const setBounds = vi.fn().mockResolvedValue({ success: true })
    const setIgnoreMouseEvents = vi.fn().mockResolvedValue({ success: true })
    vi.stubGlobal(
      '$ipc',
      {
        window: { getBounds, setBounds, setIgnoreMouseEvents },
      } as unknown as Window['$ipc'],
    )

    const onDragStart = vi.fn()
    const resolveBounds = vi.fn((intended: { x: number, y: number }) => ({
      x: intended.x + 0.4,
      y: intended.y + 0.6,
    }))
    const { result } = renderHook(() => useWindowDrag(WindowType.FOCUS_NATIVE, { onDragStart, resolveBounds }))
    const target = createPointerTarget()

    await act(async () => {
      result.current.onPointerDown(pointerEvent(target, { pointerId: 1, screenX: 100, screenY: 200 }))
      await Promise.resolve()
    })
    act(() => {
      result.current.onPointerMove(pointerEvent(target, { pointerId: 1, screenX: 105, screenY: 226 }))
    })

    expect(onDragStart).toHaveBeenCalledOnce()
    expect(resolveBounds).toHaveBeenCalledTimes(1)
    expect(resolveBounds).toHaveBeenLastCalledWith({ x: 15, y: 46 })
    expect(setBounds).toHaveBeenCalledTimes(1)
    expect(setBounds).toHaveBeenLastCalledWith(WindowType.FOCUS_NATIVE, { x: 15, y: 47 })
    expect(setIgnoreMouseEvents).toHaveBeenCalledTimes(1)
    expect(setIgnoreMouseEvents).toHaveBeenLastCalledWith(WindowType.FOCUS_NATIVE, false)
  })

  it('keeps the legacy no-drag attribute and skips drag setup for interactive targets', () => {
    const getBounds = vi.fn()
    const setPointerCapture = vi.fn()
    const setIgnoreMouseEvents = vi.fn().mockResolvedValue({ success: true })
    vi.stubGlobal(
      '$ipc',
      {
        window: {
          getBounds,
          setBounds: vi.fn(),
          setIgnoreMouseEvents,
        },
      } as unknown as Window['$ipc'],
    )

    const { result } = renderHook(() => useWindowDrag(WindowType.FOCUS_NATIVE))
    const wrapper = document.createElement('div')
    wrapper.dataset.noWindowDrag = 'true'
    const icon = document.createElement('span')
    wrapper.append(icon)
    const target = createPointerTarget(wrapper)
    target.setPointerCapture = setPointerCapture

    act(() => {
      result.current.onPointerDown(pointerEvent(target, { target: icon, pointerId: 2 }))
    })

    expect(setIgnoreMouseEvents).toHaveBeenCalledTimes(1)
    expect(setIgnoreMouseEvents).toHaveBeenLastCalledWith(WindowType.FOCUS_NATIVE, false)
    expect(getBounds).not.toHaveBeenCalled()
    expect(setPointerCapture).not.toHaveBeenCalled()
  })

  it('does not revive a drag after pointerup when getBounds resolves late', async () => {
    let resolveBounds!: (value: { bounds: { x: number, y: number } }) => void
    const getBounds = vi.fn(() =>
      new Promise((resolve) => {
        resolveBounds = resolve
      })
    )
    const setBounds = vi.fn()
    vi.stubGlobal(
      '$ipc',
      {
        window: {
          getBounds,
          setBounds,
          setIgnoreMouseEvents: vi.fn().mockResolvedValue({ success: true }),
        },
      } as unknown as Window['$ipc'],
    )

    const { result } = renderHook(() => useWindowDrag(WindowType.FOCUS_NATIVE))
    const target = createPointerTarget()

    act(() => {
      result.current.onPointerDown(pointerEvent(target, { pointerId: 3 }))
      result.current.onPointerUp(pointerEvent(target, { pointerId: 3 }))
    })
    await act(async () => {
      resolveBounds({ bounds: { x: 1, y: 2 } })
      await Promise.resolve()
    })
    act(() => {
      result.current.onPointerMove(pointerEvent(target, { pointerId: 3, screenX: 20, screenY: 20 }))
    })

    expect(setBounds).not.toHaveBeenCalled()
  })
  it('ignores bounds from an earlier drag even when the mouse reuses its pointer id', async () => {
    let finishOld!: (value: { bounds: { x: number, y: number } }) => void
    const getBounds = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
      .mockResolvedValueOnce({ bounds: { x: 300, y: 400 } })
    const setBounds = vi.fn()
    vi.stubGlobal('$ipc', { window: { getBounds, setBounds, setIgnoreMouseEvents: vi.fn() } })
    const { result } = renderHook(() => useWindowDrag(WindowType.FOCUS_NATIVE))
    const target = createPointerTarget()
    await act(async () => {
      result.current.onPointerDown(pointerEvent(target))
      result.current.onPointerUp(pointerEvent(target))
      result.current.onPointerDown(pointerEvent(target))
      await Promise.resolve()
      finishOld({ bounds: { x: 0, y: 0 } })
      await Promise.resolve()
    })
    act(() => {
      result.current.onPointerMove(pointerEvent(target, { screenX: 110, screenY: 220 }))
    })
    expect(setBounds).toHaveBeenLastCalledWith(WindowType.FOCUS_NATIVE, { x: 310, y: 420 })
  })

})

function createPointerTarget(parent?: HTMLElement): HTMLElement {
  const target = parent ?? document.createElement('div')
  target.setPointerCapture = vi.fn()
  target.hasPointerCapture = vi.fn().mockReturnValue(true)
  target.releasePointerCapture = vi.fn()
  return target
}

function pointerEvent(
  currentTarget: HTMLElement,
  overrides: Partial<Pick<React.PointerEvent<HTMLElement>, 'pointerId' | 'screenX' | 'screenY' | 'target'>> = {},
): React.PointerEvent<HTMLElement> {
  return {
    button: 0,
    currentTarget,
    pointerId: 1,
    screenX: 100,
    screenY: 200,
    target: currentTarget,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as React.PointerEvent<HTMLElement>
}

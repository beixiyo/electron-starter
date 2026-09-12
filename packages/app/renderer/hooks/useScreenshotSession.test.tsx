// @vitest-environment jsdom
/** 真正订阅 IPC 事件，验证主动截图与主进程定向截图不会被多个宿主重复消费。 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useScreenshotSession } from './useScreenshotSession'

vi.mock('@/utils/env', () => ({ isElectron: () => true }))

afterEach(() => vi.unstubAllGlobals())

it('按角色交付无申请方截图，保留主动申请者的会话隔离和取消通知', async () => {
  const listeners = new Map<string, Set<(payload: any) => void>>()
  vi.stubGlobal('$ipc', { screenshot: {
    startCapture: vi.fn(async () => ({ captureId: 'owned' })),
    on: (event: string, listener: (payload: any) => void) => {
      const group = listeners.get(event) ?? new Set()
      group.add(listener)
      listeners.set(event, group)
      return () => group.delete(listener)
    },
  } })
  const emit = (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(payload)
  }
  const primary = vi.fn()
  const secondary = vi.fn()
  const owned = vi.fn()
  const canceled = vi.fn()
  const a = renderHook(() => useScreenshotSession(primary, { fallbackRole: 'primary', onCancelled: canceled }))
  const b = renderHook(() => useScreenshotSession(secondary, { fallbackRole: 'secondary' }))
  const c = renderHook(() => useScreenshotSession(owned))
  try {
    await act(async () => {
      await c.result.current.startCapture()
      emit('ok', { captureId: 'global', fallbackRole: 'primary', bytes: new Uint8Array([1, 2]).buffer })
    })
    expect(primary).toHaveBeenCalledOnce()
    expect(primary.mock.calls[0][0]).toBeInstanceOf(Blob)
    expect(secondary).not.toHaveBeenCalled()
    expect(owned).not.toHaveBeenCalled()
    await act(async () => {
      emit('ok', { captureId: 'owned', bytes: new Uint8Array([3]).buffer })
      emit('cancel', { captureId: 'global-next', fallbackRole: 'primary' })
    })
    expect(owned).toHaveBeenCalledOnce()
    expect(canceled).toHaveBeenCalledOnce()
    expect(primary).toHaveBeenCalledOnce()
  }
  finally {
    a.unmount()
    b.unmount()
    c.unmount()
  }
  expect([...listeners.values()].every(group => group.size === 0)).toBe(true)
})

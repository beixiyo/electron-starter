// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyForceOffline, cleanupForceOffline } from './forceOffline'

afterEach(() => {
  cleanupForceOffline()
})

describe('forceOffline', () => {
  it('restores an existing navigator own descriptor and reports the real state on recovery', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine')
    const events: string[] = []
    const onOffline = vi.fn(() => events.push('offline'))
    const onOnline = vi.fn(() => events.push('online'))
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      enumerable: true,
      get: () => true,
    })

    expect(applyForceOffline(true)).toBe(true)
    expect(navigator.onLine).toBe(false)
    expect(applyForceOffline(false)).toBe(true)
    expect(navigator.onLine).toBe(true)
    expect(events).toEqual(['offline', 'online'])
    expect(Object.getOwnPropertyDescriptor(navigator, 'onLine')).toEqual({
      configurable: true,
      enumerable: true,
      get: expect.any(Function),
    })

    window.removeEventListener('offline', onOffline)
    window.removeEventListener('online', onOnline)
    if (originalDescriptor) Object.defineProperty(navigator, 'onLine', originalDescriptor)
    else Reflect.deleteProperty(navigator, 'onLine')
  })

  it('does not replace a descriptor installed by another owner while forced offline', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine')
    const externalGetter = vi.fn(() => true)
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      enumerable: true,
      get: () => false,
    })

    expect(applyForceOffline(true)).toBe(true)
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      enumerable: true,
      get: externalGetter,
    })

    expect(applyForceOffline(false)).toBe(true)
    expect(Object.getOwnPropertyDescriptor(navigator, 'onLine')?.get).toBe(externalGetter)
    expect(navigator.onLine).toBe(true)

    if (originalDescriptor) Object.defineProperty(navigator, 'onLine', originalDescriptor)
    else Reflect.deleteProperty(navigator, 'onLine')
  })
})

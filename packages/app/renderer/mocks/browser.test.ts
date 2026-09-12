// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  const worker = {
    resetHandlers: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }
  return { worker, setupWorker: vi.fn(() => worker) }
})

vi.mock('msw/browser', () => ({ setupWorker: harness.setupWorker }))

describe('mock worker lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    harness.setupWorker.mockClear()
    harness.worker.resetHandlers.mockReset()
    harness.worker.start.mockReset()
    harness.worker.stop.mockReset()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new URL('http://localhost/index.html'),
    })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistrations: vi.fn(async () => []),
      },
    })
    vi.resetModules()
  })

  it('serializes start then full off, clears old handlers, and unregisters only the exact worker URL', async () => {
    const registrations = [
      {
        active: { scriptURL: 'http://localhost/mockServiceWorker.js' },
        installing: null,
        waiting: null,
        unregister: vi.fn(async () => true),
      },
      {
        active: { scriptURL: 'http://localhost/mockServiceWorker.js?other' },
        installing: null,
        waiting: null,
        unregister: vi.fn(async () => true),
      },
    ]
    navigator.serviceWorker.getRegistrations = vi.fn(async () => registrations as never)
    harness.worker.start.mockResolvedValue(undefined)
    localStorage.setItem(
      'app:mock-debug-config',
      JSON.stringify({
        endpointScenarios: { probe: 'success' },
      }),
    )

    const browser = await import('./browser')
    const firstHandler = {} as never
    browser.setMockDefinitions([{
      id: 'probe',
      label: 'Probe',
      scenarios: [{ id: 'success', label: 'Success', handlers: [firstHandler] }],
    }])
    await browser.syncMockWorker()
    expect(harness.worker.resetHandlers).toHaveBeenNthCalledWith(1, firstHandler)

    localStorage.setItem('app:mock-debug-config', JSON.stringify({ endpointScenarios: { probe: 'off' } }))
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'app:mock-debug-config',
        newValue: JSON.stringify({ endpointScenarios: { probe: 'off' } }),
      }),
    )
    const stopping = browser.syncMockWorker()
    await stopping
    expect(harness.worker.start).toHaveBeenCalledOnce()
    expect(harness.worker.stop).toHaveBeenCalledOnce()
    expect(harness.worker.resetHandlers).toHaveBeenNthCalledWith(2)
    expect(registrations[0].unregister).toHaveBeenCalledOnce()
    expect(registrations[1].unregister).not.toHaveBeenCalled()

    harness.worker.start.mockResolvedValue(undefined)
    browser.setMockDefinitions([{
      id: 'probe',
      label: 'Probe',
      scenarios: [{ id: 'success', label: 'Success', handlers: [{} as never] }],
    }])
    localStorage.setItem('app:mock-debug-config', JSON.stringify({ endpointScenarios: { probe: 'success' } }))
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'app:mock-debug-config',
        newValue: JSON.stringify({ endpointScenarios: { probe: 'success' } }),
      }),
    )
    await browser.syncMockWorker()
    expect(harness.worker.start).toHaveBeenCalledTimes(2)
    expect(harness.worker.resetHandlers).toHaveBeenCalledTimes(3)
  })

  it('does not install handlers when full off supersedes a pending start', async () => {
    localStorage.setItem('app:mock-debug-config', JSON.stringify({ endpointScenarios: { probe: 'success' } }))
    let resolveStart!: () => void
    harness.worker.start.mockImplementation(() =>
      new Promise<void>((resolve) => {
        resolveStart = resolve
      })
    )

    const browser = await import('./browser')
    const handler = {} as never
    browser.setMockDefinitions([{
      id: 'probe',
      label: 'Probe',
      scenarios: [{ id: 'success', label: 'Success', handlers: [handler] }],
    }])

    const starting = browser.syncMockWorker()
    await vi.waitFor(() => expect(harness.worker.start).toHaveBeenCalledOnce())

    const offConfig = JSON.stringify({ endpointScenarios: { probe: 'off' } })
    localStorage.setItem('app:mock-debug-config', offConfig)
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'app:mock-debug-config',
        newValue: offConfig,
      }),
    )
    const stopping = browser.stopMockWorker()
    resolveStart()

    await Promise.all([starting, stopping])
    expect(harness.worker.resetHandlers).not.toHaveBeenCalledWith(handler)
    expect(harness.worker.stop).toHaveBeenCalledOnce()
  })
})

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('mock configuration storage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('persists endpoint scenarios and applies another window storage update', async () => {
    const config = await import('./config')
    const listener = vi.fn()
    const unsubscribe = config.subscribeMockConfig(listener)

    config.setMockEndpointScenario('probe', 'failure')
    config.setMockConfig({ delayPreset: 'slow', forceOffline: true })

    expect(JSON.parse(localStorage.getItem(config.MOCK_CONFIG_STORAGE_KEY)!)).toMatchObject({
      endpointScenarios: { probe: 'failure' },
      delayPreset: 'slow',
      forceOffline: true,
    })

    const next = JSON.stringify({
      endpointScenarios: { probe: 'success' },
      delayPreset: 'fast',
      forceOffline: false,
    })
    localStorage.setItem(config.MOCK_CONFIG_STORAGE_KEY, next)
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: config.MOCK_CONFIG_STORAGE_KEY,
        newValue: next,
        storageArea: localStorage,
      }),
    )

    expect(config.getMockConfig()).toEqual(JSON.parse(next))
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })
})

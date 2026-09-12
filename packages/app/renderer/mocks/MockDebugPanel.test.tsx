// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const worker = { resetHandlers: vi.fn(), start: vi.fn(), stop: vi.fn() }
vi.mock('msw/browser', () => ({ setupWorker: () => worker }))

afterEach(cleanup)

describe('MockDebugPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('renders only injected endpoint definitions and updates their scenario', async () => {
    const runtime = await import('./index')
    runtime.setMockDefinitions([{
      id: 'probe',
      label: 'Probe endpoint',
      scenarios: [{ id: 'success', label: 'Success', handlers: [] }],
    }])
    const { MockDebugPanel } = await import('./MockDebugPanel')
    render(<MockDebugPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Open mock panel' }))
    expect(screen.getByText('Probe endpoint')).toBeTruthy()
    expect(screen.queryByText('Undeclared endpoint')).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Probe endpoint scenario' }), { target: { value: 'success' } })

    expect(runtime.getMockConfig().endpointScenarios).toEqual({ probe: 'success' })
  })
})

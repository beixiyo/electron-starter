// @vitest-environment jsdom

import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { Children, cloneElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnvSwitchPanel } from './EnvSwitchPanel'
import { useMultiTapTrigger } from './useMultiTapTrigger'

const runtimeEnv = vi.hoisted(() => ({
  RUNTIME_ENV_PRESETS: { local: {} },
  getRuntimeEnvOverride: vi.fn(() => ({ presetId: 'builtin' as const, custom: {} })),
  resolveRuntimeEnvEndpoints: vi.fn(() => ({
    apiBaseUrl: 'https://api.example.test',
    wsBaseUrl: 'wss://api.example.test',
    appleRedirectUri: 'https://example.test/apple',
    googleRedirectUri: 'https://example.test/google',
  })),
  setRuntimeEnvOverride: vi.fn(),
}))

vi.mock('@/config/runtimeEnv', () => runtimeEnv)
vi.mock('comps', () => ({
  Button: ({ children, disabled, name, onClick, title, type = 'button' }: any) => (
    <button disabled={ disabled } name={ name } title={ title } type={ type } onClick={ onClick }>{ children }</button>
  ),
  ButtonGroup: ({ active, children, onChange }: any) => (
    <div data-active={ active }>
      { Children.map(children, (child: any) => cloneElement(child, { onClick: () => onChange(child.props.name) })) }
    </div>
  ),
  Input: ({ onChange, value, ...props }: any) => <input { ...props } value={ value } onChange={ (event) => onChange?.(event.target.value) } />,
  Modal: ({ children, footer, isOpen }: any) =>
    isOpen
      ? <div role="dialog">{ children }{ footer }</div>
      : null,
}))
vi.mock('styles/variable', () => ({ default: new Proxy({}, { get: () => '' }) }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  runtimeEnv.setRuntimeEnvOverride.mockReset()
})

describe('useMultiTapTrigger', () => {
  it('reaches the threshold without preventing the original pointer event', () => {
    const onTrigger = vi.fn()
    const originalHandler = vi.fn()
    document.addEventListener('pointerdown', originalHandler)
    renderHook(() =>
      useMultiTapTrigger({
        width: 400,
        height: 40,
        count: 7,
        onTrigger,
      })
    )

    for (let index = 0; index < 7; index++) {
      const event = new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 500,
        clientY: 20,
      })
      document.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }

    expect(onTrigger).toHaveBeenCalledOnce()
    expect(originalHandler).toHaveBeenCalledTimes(7)
    document.removeEventListener('pointerdown', originalHandler)
  })

  it('resets the sequence after an outside tap', () => {
    const onTrigger = vi.fn()
    renderHook(() =>
      useMultiTapTrigger({
        width: 400,
        height: 40,
        count: 3,
        onTrigger,
      })
    )

    fireEvent.pointerDown(document, { clientX: 500, clientY: 20 })
    fireEvent.pointerDown(document, { clientX: 10, clientY: 20 })
    fireEvent.pointerDown(document, { clientX: 500, clientY: 20 })
    fireEvent.pointerDown(document, { clientX: 500, clientY: 20 })

    expect(onTrigger).not.toHaveBeenCalled()
  })
})

describe('EnvSwitchPanel', () => {
  it('keeps the panel open and exposes a persistence error', () => {
    runtimeEnv.setRuntimeEnvOverride.mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    const onClose = vi.fn()
    render(<EnvSwitchPanel isOpen onClose={ onClose } />)

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(screen.getByRole('alert').textContent).toContain('storage unavailable')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('resets an edited draft before applying it', () => {
    const onClose = vi.fn()
    render(<EnvSwitchPanel isOpen onClose={ onClose } />)

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    const apiInput = screen.getByPlaceholderText('https://api.example.test')
    fireEvent.change(apiInput, { target: { value: 'https://custom.example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(runtimeEnv.setRuntimeEnvOverride).toHaveBeenCalledWith({ presetId: 'builtin', custom: {} })
    expect(onClose).toHaveBeenCalledOnce()
  })
})

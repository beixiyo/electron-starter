// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'

vi.mock('@/logging', () => ({
  createRendererFeatureLogger: () => ({ error: vi.fn() }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(() => {
  delete window.__appErrorBoundaryRegistry
  delete window.__appListErrorBoundaries
  delete window.__appThrowRenderError
})

describe('AppErrorBoundary', () => {
  it('scope 变化会复位真实 render error，compact fallback 仍可重试', () => {
    const view = render(
      <AppErrorBoundary scope="first" compact>
        <CrashWhenEnabled enabled />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'errorBoundary.retry' })).toBeTruthy()

    view.rerender(
      <AppErrorBoundary scope="second" compact>
        <CrashWhenEnabled enabled={ false } />
      </AppErrorBoundary>,
    )

    expect(screen.getByText('healthy')).toBeTruthy()
  })

  it('DEV 注册表按 scope 注入真实崩溃并在卸载后清理', () => {
    const view = render(
      <AppErrorBoundary scope="panel">
        <span>healthy</span>
      </AppErrorBoundary>,
    )

    if (!import.meta.env.DEV) return

    expect(window.__appListErrorBoundaries?.()).toEqual(['panel'])
    let accepted = false
    act(() => {
      accepted = window.__appThrowRenderError?.('panel', 'injected') ?? false
    })
    expect(accepted).toBe(true)
    expect(screen.getByRole('alert')).toBeTruthy()

    view.unmount()
    expect(window.__appListErrorBoundaries).toBeUndefined()
    expect(window.__appThrowRenderError).toBeUndefined()
  })
})

function CrashWhenEnabled(props: { enabled: boolean }): React.JSX.Element {
  if (props.enabled) throw new Error('render failed')
  return <span>healthy</span>
}

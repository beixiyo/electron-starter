// @vitest-environment jsdom

import { createElement } from 'react'
import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  state: {
    status: 'available' as 'available' | 'error',
    info: { version: '1.3.0', releaseNotes: '' },
    progress: null,
    error: null as string | null,
    currentVersion: '1.2.3',
    modalOpen: true,
    forceUpdate: true,
    policyTitle: '',
    policyNotes: '',
  },
  close: vi.fn(),
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
}))

vi.mock('comps', () => ({
  Button: ({ children, onClick, ...props }: { children: ReactNode, onClick?: () => void }) => createElement('button', { ...props, onClick, type: 'button' }, children),
  Modal: ({ children, footer, escToClose }: { children: ReactNode, footer?: ReactNode, escToClose?: boolean }) => createElement(
    'section',
    { 'data-testid': 'modal', 'data-esc-to-close': String(escToClose) },
    children,
    footer,
  ),
  ProgressBar: () => createElement('div', { 'data-testid': 'progress' }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en-US' },
  }),
}))

vi.mock('@/store/updaterStore', () => ({
  checkUpdate: harness.check,
  closeUpdaterModal: harness.close,
  downloadUpdate: harness.download,
  installUpdate: harness.install,
  updateErrorI18nKey: (error: string | null) => `errors.${error ?? 'unknown'}`,
  updaterAvailable: true,
  useUpdaterState: () => harness.state,
}))

import { UpdaterModal } from './UpdaterModal'

beforeEach(() => {
  harness.state.status = 'available'
  harness.state.info = { version: '1.3.0', releaseNotes: '' }
  harness.state.error = null
  harness.state.modalOpen = true
  harness.state.forceUpdate = true
  harness.state.policyTitle = ''
  harness.state.policyNotes = ''
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('UpdaterModal 强制更新边界', () => {
  it('强更时关闭入口与 Escape 都被禁用，下载仍可执行', () => {
    const view = render(<UpdaterModal />)

    expect(screen.getByTestId('modal').getAttribute('data-esc-to-close')).toBe('false')
    expect(screen.queryByRole('button', { name: 'actions.later' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'actions.download' }))
    expect(harness.download).toHaveBeenCalledOnce()

    view.unmount()
    harness.state = { ...harness.state, forceUpdate: false }
    render(<UpdaterModal />)
    expect(screen.getByTestId('modal').getAttribute('data-esc-to-close')).toBe('true')
    expect(screen.getByRole('button', { name: 'actions.later' })).toBeTruthy()
  })

  it('强更错误态只保留重试，不渲染会被静默拦截的关闭按钮', () => {
    harness.state.status = 'error'
    harness.state.error = 'network'
    const view = render(<UpdaterModal />)

    expect(screen.queryByRole('button', { name: 'actions.close' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'actions.retry' }))
    expect(harness.check).toHaveBeenCalledOnce()

    view.unmount()
  })
})

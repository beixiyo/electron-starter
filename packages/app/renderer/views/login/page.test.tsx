// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loginMocks = vi.hoisted(() => {
  const callback = { current: null as ((delivery: OAuthDelivery) => void) | null }
  return {
    api: {
      oauthLogin: vi.fn(),
    },
    callback,
    acknowledgeCallback: vi.fn(() => Promise.resolve()),
    buildClientContext: vi.fn(() => ({ client_name: 'desktop' })),
    consumeCallback: vi.fn((params: OAuthParams) => ({
      ok: true as const,
      authorizationCode: params.code ?? '',
      state: params.state ?? '',
      provider: params.provider ?? 'google',
      username: null,
    })),
    loggedIn: vi.fn(),
    message: {
      danger: vi.fn(),
      success: vi.fn(),
    },
    navigate: vi.fn(),
    translate: vi.fn((key: string) => key),
    on: vi.fn((_event: string, listener: (delivery: OAuthDelivery) => void) => {
      loginMocks.callback.current = listener
      return vi.fn()
    }),
    registerReceiver: vi.fn(() => Promise.resolve([] as OAuthDelivery[])),
    unregisterReceiver: vi.fn(() => Promise.resolve()),
  }
})

vi.mock('@/config', () => ({ INDEX_PAGE: '/recorder' }))
vi.mock('@/http/httpInstance', () => ({ api: { user: loginMocks.api } }))
vi.mock('@/store/user', () => ({ UserActions: { loggedIn: loginMocks.loggedIn } }))
vi.mock('@/utils/env', () => ({ isElectron: () => true }))
vi.mock('@jl-org/react-router', () => ({ useNavigate: () => loginMocks.navigate }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: loginMocks.translate }) }))
vi.mock('@jl-org/auth', () => ({
  applePopupLogin: vi.fn(),
  googlePopupCodeLogin: vi.fn(),
}))
vi.mock('comps', () => ({
  Button: ({ children, onClick, disabled }: any) => <button disabled={ disabled } onClick={ onClick }>{ children }</button>,
  Message: loginMocks.message,
}))
vi.mock('./components/EmailModal', () => ({ EmailModal: () => null }))
vi.mock('../../assets/svg/apple.svg?react', () => ({ default: () => null }))
vi.mock('./constants', () => ({
  buildAppleAuthorizeUrl: vi.fn(),
  buildClientContext: loginMocks.buildClientContext,
  buildGoogleAuthorizeUrl: vi.fn(),
  getOAuthConfig: vi.fn(() => ({
    appleClientId: 'apple-client',
    appleRedirectUri: 'app://oauth/complete',
    appleScope: 'name email',
    appleState: undefined,
    googleClientId: 'google-client',
    googleRedirectUri: 'app://oauth/complete',
  })),
}))
vi.mock('./electronOAuthCallback', () => ({ consumeElectronOAuthCallback: loginMocks.consumeCallback }))
vi.mock('./oauthState', () => ({
  clearOAuthState: vi.fn(),
  createOAuthState: vi.fn(() => 'state-token'),
}))

vi.stubGlobal('$ipc', {
  oauth: {
    acknowledgeCallback: loginMocks.acknowledgeCallback,
    on: loginMocks.on,
    registerReceiver: loginMocks.registerReceiver,
    unregisterReceiver: loginMocks.unregisterReceiver,
  },
  window: {
    openExternal: vi.fn(),
  },
})

import LoginPage from './page'

type OAuthParams = {
  code?: string
  state?: string
  provider?: 'apple' | 'google'
}

type OAuthDelivery = {
  id: string
  params: OAuthParams
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  loginMocks.api.oauthLogin.mockReset()
  loginMocks.acknowledgeCallback.mockClear()
  loginMocks.buildClientContext.mockClear()
  loginMocks.consumeCallback.mockClear()
  loginMocks.loggedIn.mockClear()
  loginMocks.message.danger.mockClear()
  loginMocks.message.success.mockClear()
  loginMocks.navigate.mockClear()
  loginMocks.on.mockClear()
  loginMocks.translate.mockClear()
  loginMocks.registerReceiver.mockReset()
  loginMocks.registerReceiver.mockReturnValue(Promise.resolve([] as OAuthDelivery[]))
  loginMocks.unregisterReceiver.mockClear()
  loginMocks.callback.current = null
})

afterEach(() => {
  cleanup()
})

describe('LoginPage Electron OAuth lifecycle', () => {
  it('does not commit a pending login after the page unmounts', async () => {
    const login = deferred<{ id: string }>()
    loginMocks.api.oauthLogin.mockReturnValue(login.promise)

    const view = render(<LoginPage />)
    await flushReact()

    await act(async () => {
      loginMocks.callback.current?.({
        id: 'callback-1',
        params: { code: 'code-1', provider: 'google', state: 'state-1' },
      })
      await Promise.resolve()
    })
    await waitFor(() => expect(loginMocks.api.oauthLogin).toHaveBeenCalledTimes(1))

    view.unmount()
    await act(async () => {
      login.resolve({ id: 'user-1' })
      await Promise.resolve()
    })

    expect(loginMocks.loggedIn).not.toHaveBeenCalled()
    expect(loginMocks.navigate).not.toHaveBeenCalled()
    expect(loginMocks.message.success).not.toHaveBeenCalled()
    expect(loginMocks.message.danger).not.toHaveBeenCalled()
  })

  it('does not let an older callback commit after a newer callback starts', async () => {
    const firstLogin = deferred<{ id: string }>()
    const secondLogin = deferred<{ id: string }>()
    loginMocks.api.oauthLogin.mockImplementation(({ authorization_code }: { authorization_code: string }) => {
      return authorization_code === 'code-1'
        ? firstLogin.promise
        : secondLogin.promise
    })

    render(<LoginPage />)
    await flushReact()

    await act(async () => {
      loginMocks.callback.current?.({
        id: 'callback-1',
        params: { code: 'code-1', provider: 'google', state: 'state-1' },
      })
      await Promise.resolve()
    })
    await waitFor(() => expect(loginMocks.api.oauthLogin).toHaveBeenCalledTimes(1))

    await act(async () => {
      loginMocks.callback.current?.({
        id: 'callback-2',
        params: { code: 'code-2', provider: 'google', state: 'state-2' },
      })
      await Promise.resolve()
    })
    await waitFor(() => expect(loginMocks.api.oauthLogin).toHaveBeenCalledTimes(2))

    await act(async () => {
      firstLogin.resolve({ id: 'user-1' })
      await Promise.resolve()
    })
    expect(loginMocks.loggedIn).not.toHaveBeenCalled()

    await act(async () => {
      secondLogin.resolve({ id: 'user-2' })
      await Promise.resolve()
    })
    expect(loginMocks.loggedIn).toHaveBeenCalledTimes(1)
    expect(loginMocks.loggedIn).toHaveBeenCalledWith({ id: 'user-2' })
    expect(loginMocks.navigate).toHaveBeenCalledTimes(1)
  })

  it('leaves callbacks returned after unmount for the next receiver', async () => {
    const pending = deferred<OAuthDelivery[]>()
    loginMocks.registerReceiver.mockReturnValue(pending.promise)

    const view = render(<LoginPage />)
    await flushReact()
    view.unmount()

    await act(async () => {
      pending.resolve([{
        id: 'callback-late',
        params: { code: 'code-late', provider: 'google', state: 'state-late' },
      }])
      await Promise.resolve()
    })

    expect(loginMocks.acknowledgeCallback).not.toHaveBeenCalled()
    expect(loginMocks.api.oauthLogin).not.toHaveBeenCalled()
  })
})

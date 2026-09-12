import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLIENT_INFO_KEY } from './constants'
import { createHttpInstance } from './httpInstance'

const BASE_URL = 'https://api.example.test/api'
const SENTINEL = Symbol('request did not settle')

type StoredUser = {
  id: number
  jwt: {
    access: string
    refresh: string
  }
}

function storeUser(overrides: Partial<StoredUser> = {}) {
  const user: StoredUser = {
    id: 7,
    jwt: {
      access: 'old-access',
      refresh: 'old-refresh',
    },
    ...overrides,
  }
  localStorage.setItem(CLIENT_INFO_KEY, JSON.stringify(user))
  return user
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestHeaders(fetchMock: ReturnType<typeof vi.fn>) {
  const lastCall = fetchMock.mock.calls.at(-1)
  return new Headers(lastCall?.[1]?.headers)
}

describe('HTTP 实例通用行为', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('anonymous 实例不读取或注入本地凭证', async () => {
    storeUser()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)

    const http = createHttpInstance({
      authMode: 'anonymous',
      baseUrl: BASE_URL,
      respInterceptor: (response) => response.data,
    })

    await http.get('/public')

    const headers = requestHeaders(fetchMock)
    expect(headers.has('authorization')).toBe(false)
    expect(headers.has('x-client-id')).toBe(false)
  })

  it('session 请求接通 timeout、应用头和自定义请求拦截器', async () => {
    storeUser()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)

    const http = createHttpInstance({
      authMode: 'session',
      baseUrl: BASE_URL,
      timeout: 42,
      getAppHeaders: () => ({
        'x-app-number': 42,
        'x-app-boolean': false,
        'x-app-empty': '',
        'x-app-null': null,
      }),
      reqInterceptor: (config) => {
        config.headers ||= {}
        config.headers['x-custom'] = 'custom'
        return config
      },
    })

    await http.get('/resource')

    const headers = requestHeaders(fetchMock)
    expect(headers.get('authorization')).toBe('Bearer old-access')
    expect(headers.get('x-client-id')).toBe('7')
    expect(headers.get('x-app-number')).toBe('42')
    expect(headers.get('x-app-boolean')).toBe('false')
    expect(headers.get('x-custom')).toBe('custom')
    expect(headers.has('x-app-empty')).toBe(false)
    expect(headers.has('x-app-null')).toBe(false)
  })

  it('动态 baseUrl 在每次请求时求值', async () => {
    let baseUrl = 'https://first.example.test/api'
    let baseUrlCalls = 0
    const urls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url)
      return jsonResponse({ data: 'ok' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const http = createHttpInstance({
      authMode: 'anonymous',
      baseUrl: () => {
        baseUrlCalls++
        return baseUrl
      },
      respInterceptor: (response) => response.data,
    })

    await http.get('/resource')
    baseUrl = 'https://second.example.test/api'
    await http.get('/resource')

    expect(urls).toEqual([
      'https://first.example.test/api/resource',
      'https://second.example.test/api/resource',
    ])
    expect(baseUrlCalls).toBe(2)
  })

  it.each([
    { code: 4006, label: '过期' },
    { code: 4100, label: '未认证' },
  ])('请求发出后切换账号，$label响应不刷新、不重放或清理新会话', async ({ code }) => {
    storeUser()
    let releaseProtected!: () => void
    const protectedStarted = new Promise<void>((resolve) => {
      releaseProtected = resolve
    })
    let refreshCalls = 0
    const onUnauthorized = vi.fn()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/account/jwt_refresh')) {
        refreshCalls++
        return jsonResponse({ data: { access: 'unexpected-access', refresh: 'unexpected-refresh' } })
      }

      await protectedStarted
      return jsonResponse({ code, msg: 'session changed' }, 401)
    })
    vi.stubGlobal('fetch', fetchMock)
    const http = createHttpInstance({
      authMode: 'session',
      baseUrl: BASE_URL,
      onUnauthorized,
    })

    const pending = http.get('/resource').catch((error) => error)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const currentUser: StoredUser = {
      id: 8,
      jwt: { access: 'current-access', refresh: 'current-refresh' },
    }
    localStorage.setItem(CLIENT_INFO_KEY, JSON.stringify(currentUser))
    releaseProtected()

    const error = await pending
    expect(error).toMatchObject({ name: 'StaleRefreshError' })
    expect(refreshCalls).toBe(0)
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(CLIENT_INFO_KEY)!)).toEqual(currentUser)
  })

  it('多个会话实例各自发送诊断事件', async () => {
    storeUser()
    const firstEvents: Array<{ event: string; pathname?: string }> = []
    const secondEvents: Array<{ event: string; pathname?: string }> = []
    const protectedCalls = new Map<string, number>()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/account/jwt_refresh')) {
        return jsonResponse({ data: { access: 'new-access', refresh: 'new-refresh' } })
      }

      const pathname = new URL(url).pathname
      const calls = (protectedCalls.get(pathname) || 0) + 1
      protectedCalls.set(pathname, calls)
      if (calls === 1) return jsonResponse({ code: 4006, msg: 'expired' }, 401)
      return jsonResponse({ data: 'ok' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = createHttpInstance({
      authMode: 'session',
      baseUrl: BASE_URL,
      onDiagnosticEvent: (event, meta) =>
        firstEvents.push({
          event,
          pathname: typeof meta.pathname === 'string'
            ? meta.pathname
            : undefined,
        }),
    })
    const second = createHttpInstance({
      authMode: 'session',
      baseUrl: BASE_URL,
      onDiagnosticEvent: (event, meta) =>
        secondEvents.push({
          event,
          pathname: typeof meta.pathname === 'string'
            ? meta.pathname
            : undefined,
        }),
    })

    await expect(first.get('/first')).resolves.toBe('ok')
    await expect(second.get('/second')).resolves.toBe('ok')

    expect(firstEvents).toContainEqual({ event: 'auth.access-expired', pathname: '/api/first' })
    expect(secondEvents).toContainEqual({ event: 'auth.access-expired', pathname: '/api/second' })
    expect(firstEvents).not.toContainEqual({ event: 'auth.access-expired', pathname: '/api/second' })
    expect(secondEvents).not.toContainEqual({ event: 'auth.access-expired', pathname: '/api/first' })
  })

  it('timeout 到期会中止未完成的 fetch', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const http = createHttpInstance({
      authMode: 'anonymous',
      baseUrl: BASE_URL,
      timeout: 20,
    })

    const outcome = http.get('/slow').then(
      () => 'resolved',
      (error) => error,
    )
    const bounded = Promise.race([
      outcome,
      new Promise((resolve) => setTimeout(() => resolve(SENTINEL), 100)),
    ])

    await vi.advanceTimersByTimeAsync(100)

    const result = await bounded
    expect(result).not.toBe(SENTINEL)
    expect(result).toMatchObject({ name: 'RequestTimeoutError' })
  })

  it('普通业务错误调用 onBizError，skip 标记可关闭回调', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      code: 4200,
      msg: 'Invalid input',
      data: { field: 'name' },
    }, 400))
    vi.stubGlobal('fetch', fetchMock)
    const onBizError = vi.fn()
    const http = createHttpInstance({
      authMode: 'anonymous',
      baseUrl: BASE_URL,
      onBizError,
    })

    await expect(http.get('/invalid')).rejects.toMatchObject({ code: 4200 })
    expect(onBizError).toHaveBeenCalledWith({
      code: 4200,
      msg: 'Invalid input',
      data: { field: 'name' },
      traceId: undefined,
    })

    onBizError.mockClear()
    await expect(http.get('/invalid', { __skipBizError: true } as any)).rejects.toMatchObject({ code: 4200 })
    expect(onBizError).not.toHaveBeenCalled()
  })

  it('刷新并发请求共享一次刷新并分别重放', async () => {
    storeUser()
    let protectedCalls = 0
    let refreshCalls = 0
    let releaseRefresh!: (response: Response) => void
    const refreshStarted = new Promise<void>((resolve) => {
      const originalResolve = resolve
      releaseRefresh = (response) => {
        refreshResponse = response
        originalResolve()
      }
    })
    let refreshResponse: Response | undefined
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/account/jwt_refresh')) {
        refreshCalls++
        await refreshStarted
        return refreshResponse!
      }

      protectedCalls++
      if (protectedCalls <= 2) return jsonResponse({ code: 4006, msg: 'expired' }, 401)

      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer new-access')
      return jsonResponse({ data: 'ok' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const http = createHttpInstance({
      authMode: 'session',
      baseUrl: BASE_URL,
    })

    const first = http.get('/first')
    const second = http.get('/second')
    await vi.waitFor(() => expect(refreshCalls).toBe(1))
    releaseRefresh(jsonResponse({ data: { access: 'new-access', refresh: 'new-refresh' } }))

    await expect(Promise.all([first, second])).resolves.toEqual(['ok', 'ok'])
    expect(refreshCalls).toBe(1)
    expect(protectedCalls).toBe(4)
  })

  it('不同显式 baseUrl 的并发刷新不会互相重放', async () => {
    storeUser()
    const baseUrlA = 'https://first.example.test/api'
    const baseUrlB = 'https://second.example.test/api'
    let releaseRefreshA!: () => void
    const refreshAStarted = new Promise<void>((resolve) => {
      releaseRefreshA = resolve
    })
    let releaseRefreshResponse!: () => void
    const refreshResponseReady = new Promise<void>((resolve) => {
      releaseRefreshResponse = resolve
    })
    let protectedCallsA = 0
    let protectedCallsB = 0
    let refreshCallsA = 0
    let refreshCallsB = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/account/jwt_refresh')) {
        if (url.startsWith(baseUrlA)) {
          refreshCallsA++
          releaseRefreshA()
          await refreshResponseReady
          return jsonResponse({ data: { access: 'access-a', refresh: 'refresh-a' } })
        }

        refreshCallsB++
        return jsonResponse({ data: { access: 'access-b', refresh: 'refresh-b' } })
      }

      if (url.startsWith(baseUrlA)) {
        protectedCallsA++
        if (protectedCallsA === 1) return jsonResponse({ code: 4006, msg: 'expired' }, 401)
        return jsonResponse({ data: 'ok-a' })
      }

      protectedCallsB++
      await refreshAStarted
      if (protectedCallsB === 1) return jsonResponse({ code: 4006, msg: 'expired' }, 401)
      return jsonResponse({ data: 'unexpected-ok-b' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const http = createHttpInstance({ authMode: 'session' })

    const first = http.get('/resource-a', { baseUrl: baseUrlA }).catch((error) => error)
    const second = http.get('/resource-b', { baseUrl: baseUrlB }).catch((error) => error)
    await vi.waitFor(() => {
      expect(refreshCallsA).toBe(1)
      expect(protectedCallsA).toBe(1)
      expect(protectedCallsB).toBe(1)
    })
    releaseRefreshResponse()

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult).toBe('ok-a')
    expect(secondResult).toMatchObject({ name: 'StaleRefreshError' })
    expect(refreshCallsA).toBe(1)
    expect(refreshCallsB).toBe(0)
    expect(protectedCallsB).toBe(1)
  })

  it('重放再次认证失败时不启动第二次刷新', async () => {
    storeUser()
    let protectedCalls = 0
    let refreshCalls = 0
    const onUnauthorized = vi.fn()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/account/jwt_refresh')) {
        refreshCalls++
        return jsonResponse({
          data: {
            access: `new-access-${refreshCalls}`,
            refresh: `new-refresh-${refreshCalls}`,
          },
        })
      }

      protectedCalls++
      return jsonResponse({ code: 4006, msg: 'expired' }, 401)
    })
    vi.stubGlobal('fetch', fetchMock)
    const http = createHttpInstance({
      authMode: 'session',
      baseUrl: BASE_URL,
      onUnauthorized,
    })

    await expect(http.get('/resource')).rejects.toMatchObject({ code: 4006 })
    expect(protectedCalls).toBe(2)
    expect(refreshCalls).toBe(1)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('认证响应码可以由实例配置覆盖', async () => {
    storeUser()
    let protectedCalls = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/account/jwt_refresh')) {
        return jsonResponse({ data: { access: 'new-access', refresh: 'new-refresh' } })
      }

      protectedCalls++
      if (protectedCalls === 1) return jsonResponse({ code: 4996, msg: 'expired' }, 401)
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer new-access')
      return jsonResponse({ data: 'ok' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const http = createHttpInstance({
      authMode: 'session',
      baseUrl: BASE_URL,
      authCodes: { refresh: 4996, logout: 4997 },
    })

    await expect(http.get('/resource')).resolves.toBe('ok')
    expect(protectedCalls).toBe(2)
  })

  it('刷新遇到瞬时 5xx 只 reject，不触发登出', async () => {
    storeUser()
    const onUnauthorized = vi.fn()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/account/jwt_refresh')) return new Response('upstream unavailable', { status: 503 })
      return jsonResponse({ code: 4006, msg: 'expired' }, 401)
    })
    vi.stubGlobal('fetch', fetchMock)
    const http = createHttpInstance({
      authMode: 'session',
      baseUrl: BASE_URL,
      onUnauthorized,
    })

    await expect(http.get('/resource')).rejects.toBeInstanceOf(Response)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('账号切换期间不回写旧刷新结果', async () => {
    storeUser()
    let releaseRefresh!: () => void
    const refreshStarted = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/account/jwt_refresh')) {
        await refreshStarted
        return jsonResponse({ data: { access: 'old-new-access', refresh: 'old-new-refresh' } })
      }
      return jsonResponse({ code: 4006, msg: 'expired' }, 401)
    })
    vi.stubGlobal('fetch', fetchMock)
    const http = createHttpInstance({ authMode: 'session', baseUrl: BASE_URL })
    const pending = http.get('/resource').catch((error) => error)

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/account/jwt_refresh`,
        expect.anything(),
      )
    )
    const currentUser: StoredUser = {
      id: 8,
      jwt: { access: 'current-access', refresh: 'current-refresh' },
    }
    localStorage.setItem(CLIENT_INFO_KEY, JSON.stringify(currentUser))
    releaseRefresh()

    const error = await pending
    expect(error).toMatchObject({ name: 'StaleRefreshError' })
    expect(JSON.parse(localStorage.getItem(CLIENT_INFO_KEY)!)).toEqual(currentUser)
  })

  it('刷新请求返回认证失败且账号已切换时不通知新会话', async () => {
    storeUser()
    let releaseRefresh!: () => void
    const refreshStarted = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    let refreshCalls = 0
    const onUnauthorized = vi.fn()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/account/jwt_refresh')) {
        refreshCalls++
        await refreshStarted
        return jsonResponse({ code: 4006, msg: 'refresh expired' }, 401)
      }

      return jsonResponse({ code: 4006, msg: 'expired' }, 401)
    })
    vi.stubGlobal('fetch', fetchMock)
    const http = createHttpInstance({
      authMode: 'session',
      baseUrl: BASE_URL,
      onUnauthorized,
    })
    const pending = http.get('/resource').catch((error) => error)

    await vi.waitFor(() => expect(refreshCalls).toBe(1))
    const currentUser: StoredUser = {
      id: 8,
      jwt: { access: 'current-access', refresh: 'current-refresh' },
    }
    localStorage.setItem(CLIENT_INFO_KEY, JSON.stringify(currentUser))
    releaseRefresh()

    const error = await pending
    expect(error).toMatchObject({ name: 'StaleRefreshError' })
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(CLIENT_INFO_KEY)!)).toEqual(currentUser)
  })

  it('环境切换期间不回写旧环境的刷新结果', async () => {
    storeUser()
    let baseUrl = 'https://first.example.test/api'
    let releaseRefresh!: () => void
    const refreshStarted = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/account/jwt_refresh')) {
        await refreshStarted
        return jsonResponse({ data: { access: 'old-new-access', refresh: 'old-new-refresh' } })
      }
      return jsonResponse({ code: 4006, msg: 'expired' }, 401)
    })
    vi.stubGlobal('fetch', fetchMock)
    const http = createHttpInstance({ authMode: 'session', baseUrl: () => baseUrl })
    const pending = http.get('/resource').catch((error) => error)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    baseUrl = 'https://second.example.test/api'
    releaseRefresh()

    const error = await pending
    expect(error).toMatchObject({ name: 'StaleRefreshError' })
    expect(JSON.parse(localStorage.getItem(CLIENT_INFO_KEY)!).jwt).toEqual({
      access: 'old-access',
      refresh: 'old-refresh',
    })
  })

  it('刷新请求返回认证失败且环境已切换时不通知旧会话', async () => {
    storeUser()
    let baseUrl = 'https://first.example.test/api'
    let releaseRefresh!: () => void
    const refreshStarted = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    let refreshCalls = 0
    const onUnauthorized = vi.fn()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/account/jwt_refresh')) {
        refreshCalls++
        await refreshStarted
        return jsonResponse({ code: 4006, msg: 'refresh expired' }, 401)
      }

      return jsonResponse({ code: 4006, msg: 'expired' }, 401)
    })
    vi.stubGlobal('fetch', fetchMock)
    const http = createHttpInstance({
      authMode: 'session',
      baseUrl: () => baseUrl,
      onUnauthorized,
    })
    const pending = http.get('/resource').catch((error) => error)

    await vi.waitFor(() => expect(refreshCalls).toBe(1))
    baseUrl = 'https://second.example.test/api'
    releaseRefresh()

    const error = await pending
    expect(error).toMatchObject({ name: 'StaleRefreshError' })
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(CLIENT_INFO_KEY)!).jwt).toEqual({
      access: 'old-access',
      refresh: 'old-refresh',
    })
  })

  it('刷新请求自身的认证失败不会再次进入刷新链路', async () => {
    storeUser()
    let refreshCalls = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/account/jwt_refresh')) {
        refreshCalls++
        return jsonResponse({ code: 4006, msg: 'refresh expired' }, 401)
      }
      return jsonResponse({ code: 4006, msg: 'expired' }, 401)
    })
    vi.stubGlobal('fetch', fetchMock)
    const onUnauthorized = vi.fn()
    const http = createHttpInstance({
      authMode: 'session',
      baseUrl: BASE_URL,
      onUnauthorized,
    })

    const outcome = http.get('/resource').catch((error) => error)
    const bounded = Promise.race([
      outcome,
      new Promise((resolve) => setTimeout(() => resolve(SENTINEL), 100)),
    ])
    const error = await bounded

    expect(error).not.toBe(SENTINEL)
    expect(error).toMatchObject({ code: 4006 })
    expect(refreshCalls).toBe(1)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})

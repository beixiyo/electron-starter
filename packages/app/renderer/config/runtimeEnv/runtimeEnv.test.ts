// @vitest-environment jsdom
/** 运行环境切换必须作用于真实请求与授权 URL，而非只改变配置面板。 */
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@/logging', () => ({
  createRendererFeatureLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}))

afterEach(() => {
  localStorage.removeItem('app:runtime-environment')
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('切换环境后下一次 HTTP 和 OAuth 使用新地址，空字段保留构建默认值', async () => {
  vi.stubGlobal('__APP_VERSION__', 'test')
  vi.stubEnv('VITE_WEB_API_BASE_URL', 'https://initial.example/api')
  vi.stubEnv('VITE_WEB_GOOGLE_CLIENT_ID', 'test-client')
  vi.stubEnv('VITE_WEB_GOOGLE_REDIRECT_URI', 'https://initial.example/oauth')
  vi.stubEnv('VITE_WEB_APPLE_REDIRECT_URI', 'https://initial.example/apple')
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  const { setRuntimeEnvOverride, getRuntimeEnv } = await import('./store')
  const { http } = await import('@/http/httpInstance')
  const { buildGoogleAuthorizeUrl } = await import('@/views/login/constants')

  await http.get('/probe')
  expect(String(fetch.mock.calls[0][0])).toBe('https://initial.example/api/probe')
  expect(new URL(buildGoogleAuthorizeUrl()).searchParams.get('redirect_uri')).toBe('https://initial.example/oauth')

  setRuntimeEnvOverride({ presetId: 'custom', custom: {
    apiBaseUrl: 'https://next.example/api',
    googleRedirectUri: 'https://next.example/oauth?mode=test&source=desktop',
    appleRedirectUri: ' ',
  } })
  await http.get('/probe')
  expect(String(fetch.mock.calls[1][0])).toBe('https://next.example/api/probe')
  const authorization = new URL(buildGoogleAuthorizeUrl('state-token'))
  expect(authorization.searchParams.get('redirect_uri')).toBe('https://next.example/oauth?mode=test&source=desktop')
  expect(authorization.searchParams.get('source')).toBeNull()
  expect(authorization.searchParams.get('state')).toBe('state-token')
  expect(getRuntimeEnv().appleRedirectUri).toBe('https://initial.example/apple')
})

it('关闭运行环境工具的构建忽略旧覆盖配置，真实请求仍使用构建地址', async () => {
  vi.stubEnv('DEV', false)
  vi.stubEnv('VITE_ENABLE_RUNTIME_TOOLS', 'false')
  vi.stubEnv('VITE_WEB_API_BASE_URL', 'https://release.example/api')
  vi.stubGlobal('__APP_VERSION__', 'test')
  localStorage.setItem('app:runtime-environment', JSON.stringify({
    presetId: 'custom', custom: { apiBaseUrl: 'https://old-debug.example/api' },
  }))
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ data: {} })))
  vi.stubGlobal('fetch', fetch)
  const { http } = await import('@/http/httpInstance')
  await http.get('/probe')
  expect(String(fetch.mock.calls[0][0])).toBe('https://release.example/api/probe')
})

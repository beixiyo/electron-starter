/** 网络错误保持身份，HTTP 错误保留响应体；已锁定的响应不得再次克隆。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpInstance } from './httpInstance'

describe('HTTP 错误交付', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('网络失败保留原始 TypeError，调用方可以识别并重试', async () => {
    const error = new TypeError('connection interrupted')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
    const http = createHttpInstance({ baseUrl: 'https://api.example.test' })

    await expect(http.get('/resource')).rejects.toBe(error)
  })

  it('非 JSON 错误响应保留状态码及未消费的响应体', async () => {
    const response = new Response('upstream unavailable', { status: 502 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    const http = createHttpInstance({ baseUrl: 'https://api.example.test' })

    const error = await http.get('/resource').catch(error => error)
    expect(error).toBe(response)
    expect(error.status).toBe(502)
    await expect(error.text()).resolves.toBe('upstream unavailable')
  })

  it('响应体由其他 reader 持有时，不尝试克隆并破坏原始错误', async () => {
    const response = new Response('upstream unavailable', { status: 502 })
    const reader = response.body!.getReader()
    const clone = vi.spyOn(response, 'clone')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    const http = createHttpInstance({ baseUrl: 'https://api.example.test' })

    try {
      await expect(http.get('/resource')).rejects.toBe(response)
      expect(clone).not.toHaveBeenCalled()
    }
    finally {
      reader.releaseLock()
    }
  })

  it('服务端业务提示转为带错误码的 Error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 4200, msg: 'Invalid input' }), { status: 400 })))
    const http = createHttpInstance({ baseUrl: 'https://api.example.test' })

    const error = await http.get('/resource').catch(error => error)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ message: 'Invalid input', code: 4200 })
  })
})

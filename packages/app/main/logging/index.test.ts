import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: vi.fn() } }))

import { toErrorDetail } from './index'

describe('诊断日志错误详情', () => {
  it('提取 Error 的不可枚举字段并限制 cause 深度', () => {
    let cause: Error = new Error('leaf')
    for (let index = 0; index < 5; index++)
      cause = new Error(`cause-${index}`, { cause })

    const error = new Error('root', { cause })
    Object.assign(error, {
      code: 'E_TEST',
      requestHeaders: { authorization: 'secret-token' },
      responseBody: 'private response',
    })

    const detail = toErrorDetail(error) as Record<string, unknown>
    expect(detail).toMatchObject({ name: 'Error', message: 'root', code: 'E_TEST' })
    expect(detail).not.toHaveProperty('requestHeaders')
    expect(detail).not.toHaveProperty('responseBody')
    expect(JSON.stringify(detail)).not.toContain('secret-token')

    let current = detail
    for (let index = 0; index < 3; index++) {
      current = current.cause as Record<string, unknown>
      expect(current).toBeDefined()
    }
    expect(current).not.toHaveProperty('cause')
  })

  it('非 Error 对象也只保留安全字段，不枚举请求内容', () => {
    const detail = toErrorDetail({
      message: 'request failed',
      code: 'E_REQUEST',
      headers: { authorization: 'secret-token' },
      body: { password: 'secret-password' },
    }) as Record<string, unknown>

    expect(detail).toMatchObject({ name: 'ThrownValue', message: 'request failed', code: 'E_REQUEST' })
    expect(JSON.stringify(detail)).not.toContain('authorization')
    expect(JSON.stringify(detail)).not.toContain('secret-password')
  })
})

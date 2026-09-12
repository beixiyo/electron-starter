import { describe, expect, it } from 'vitest'
import { classifyUpdateError } from './error'

describe('自动更新错误分类', () => {
  it('把连接超时错误归为 network，且不把原始 URL 泄露给 renderer', () => {
    const error = Object.assign(new Error('Request timed out for https://user:secret@example.invalid/feed'), {
      code: 'ETIMEDOUT',
    })

    expect(classifyUpdateError(error)).toBe('network')
    expect(classifyUpdateError(error)).not.toContain('secret')
  })

  it('把更新源不存在、校验失败和未知错误分别归类', () => {
    expect(classifyUpdateError(new Error('Cannot find channel latest-mac.yml'))).toBe('notFound')
    expect(classifyUpdateError(new Error('sha512 checksum mismatch'))).toBe('verification')
    expect(classifyUpdateError({ code: 'ERR_UNEXPECTED', message: 'unexpected response' })).toBe('unknown')
  })

  it('识别带错误码但没有 Error 原型的主进程异常', () => {
    expect(classifyUpdateError({ code: 'ECONNRESET', message: 'socket closed' })).toBe('network')
    expect(classifyUpdateError({ code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND', message: '' })).toBe('notFound')
  })
})

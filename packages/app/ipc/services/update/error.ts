import type { UpdateErrorCode } from './contract'

/**
 * 把自动更新引擎的异常归一化为有限错误码。
 *
 * 原始异常可能带 URL、请求头或本地路径，不能跨 IPC 透传给渲染层；调用方只应把返回码
 * 放入更新状态，用户可读文案由 renderer 的 locale 决定。
 */
export function classifyUpdateError(error: unknown): UpdateErrorCode {
  const { code, message } = readErrorFields(error)
  const haystack = `${code} ${message}`.toLowerCase()

  if (hasAny(haystack, [
    'cannot find channel',
    '404 not found',
    '404',
    'channel_file_not_found',
    'no_published_version',
  ]))
    return 'notFound'

  if (hasAny(haystack, [
    'sha512',
    'checksum',
    'integrity',
    'signature',
    'invalid_signature',
  ]))
    return 'verification'

  if (hasAny(haystack, [
    'net::',
    'enotfound',
    'econnrefused',
    'econnreset',
    'etimedout',
    'enetunreach',
    'ehostunreach',
    'eai_again',
    'socket hang up',
    'request timed out',
    'network',
  ]))
    return 'network'

  return 'unknown'
}

/** 只读取错误的分类字段与短消息，避免把原始对象序列化进日志或 IPC。 */
function readErrorFields(error: unknown): { code: string, message: string } {
  if (error instanceof Error)
    return { code: readCode(error), message: error.message }

  if (typeof error === 'object' && error !== null) {
    const candidate = error as { code?: unknown, message?: unknown }
    const code = typeof candidate.code === 'string'
      ? candidate.code
      : ''
    const message = typeof candidate.message === 'string'
      ? candidate.message
      : ''
    return { code, message }
  }

  return {
    code: '',
    message: typeof error === 'string'
      ? error
      : '',
  }
}

function readCode(error: Error): string {
  const code = (error as Error & { code?: unknown }).code
  return typeof code === 'string'
    ? code
    : ''
}

function hasAny(value: string, tokens: readonly string[]): boolean {
  return tokens.some(token => value.includes(token))
}

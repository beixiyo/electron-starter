/**
 * 管理桌面 OAuth 请求的短期 state，回调消费后立即失效，防止 CSRF 和重放
 */
import { generateRandomId } from 'utils'

const OAUTH_STATE_KEY_PREFIX = 'oauth-state:'
const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000

/** 创建并保存一次性的 OAuth state */
export function createOAuthState(options: CreateOAuthStateOptions): string {
  const {
    provider,
    storage,
    now = Date.now,
    ttlMs = DEFAULT_STATE_TTL_MS,
  } = options
  const state = generateRandomId()

  storage.setItem(getStorageKey(provider), JSON.stringify({
    state,
    expiresAt: now() + ttlMs,
  } satisfies StoredOAuthState))

  return state
}

/**
 * 消费并校验 OAuth state
 *
 * 仅匹配成功时消费记录；畸形或过期记录会清理，错误 state 不得取消真实登录
 */
export function consumeOAuthState(options: ConsumeOAuthStateOptions): OAuthStateValidationResult {
  const { provider, returnedState, storage, now = Date.now } = options
  const key = getStorageKey(provider)
  const serialized = storage.getItem(key)

  if (!serialized)
    return { valid: false, reason: 'missing' }

  const stored = parseStoredState(serialized)
  if (!stored) {
    storage.removeItem(key)
    return { valid: false, reason: 'invalid' }
  }
  if (stored.expiresAt <= now()) {
    storage.removeItem(key)
    return { valid: false, reason: 'expired' }
  }
  if (!returnedState || !constantTimeEqual(stored.state, returnedState))
    return { valid: false, reason: 'mismatch' }

  storage.removeItem(key)
  return { valid: true }
}

/** 清除未能打开授权页时遗留的 OAuth state */
export function clearOAuthState(provider: OAuthProvider, storage: Storage): void {
  storage.removeItem(getStorageKey(provider))
}

function getStorageKey(provider: OAuthProvider): string {
  return `${OAUTH_STATE_KEY_PREFIX}${provider}`
}

function parseStoredState(value: string): StoredOAuthState | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object')
      return null

    const state = Reflect.get(parsed, 'state')
    const expiresAt = Reflect.get(parsed, 'expiresAt')
    return typeof state === 'string' && typeof expiresAt === 'number'
      ? { state, expiresAt }
      : null
  }
  catch {
    return null
  }
}

function constantTimeEqual(expected: string, actual: string): boolean {
  let difference = expected.length ^ actual.length
  const length = Math.max(expected.length, actual.length)

  for (let index = 0; index < length; index++)
    difference |= (expected.charCodeAt(index) || 0) ^ (actual.charCodeAt(index) || 0)

  return difference === 0
}

type OAuthProvider = 'apple' | 'google'

type StoredOAuthState = {
  state: string
  expiresAt: number
}

type CreateOAuthStateOptions = {
  provider: OAuthProvider
  storage: Storage
  now?: () => number
  ttlMs?: number
}

type ConsumeOAuthStateOptions = {
  provider: OAuthProvider
  returnedState?: string
  storage: Storage
  now?: () => number
}

export type OAuthStateValidationResult
  = | { valid: true }
    | { valid: false, reason: 'missing' | 'invalid' | 'expired' | 'mismatch' }

/**
 * 校验并归一化 Electron OAuth 回调，只有通过一次性 state 校验后才生成登录参数
 */
import type { OAuthCallbackParams } from '@shared'
import { consumeOAuthState } from './oauthState'

export function consumeElectronOAuthCallback(
  params: ElectronOAuthCallbackParams,
  storage: Storage,
): ElectronOAuthCallbackResult {
  if (params.provider !== 'apple' && params.provider !== 'google')
    return { ok: false, reason: 'unsupported_provider' }

  const stateResult = consumeOAuthState({
    provider: params.provider,
    returnedState: params.state,
    storage,
  })

  if (!stateResult.valid)
    return { ok: false, reason: `state_${stateResult.reason}` }
  if (params.error) {
    return { ok: false, reason: params.error === 'access_denied'
      ? 'access_denied'
      : 'provider_error' }
  }
  if (!params.code)
    return { ok: false, reason: 'missing_code' }

  return {
    ok: true,
    authorizationCode: params.code,
    state: params.state!,
    provider: params.provider,
    username: params.provider === 'apple' && typeof params.username === 'string'
      ? params.username
      : null,
  }
}

export type ElectronOAuthCallbackParams = OAuthCallbackParams

export type ElectronOAuthCallbackResult
  = | {
    ok: true
    authorizationCode: string
    state: string
    provider: 'apple' | 'google'
    username: string | null
  }
  | {
    ok: false
    reason:
      | 'unsupported_provider'
      | 'state_missing'
      | 'state_invalid'
      | 'state_expired'
      | 'state_mismatch'
      | 'access_denied'
      | 'provider_error'
      | 'missing_code'
  }

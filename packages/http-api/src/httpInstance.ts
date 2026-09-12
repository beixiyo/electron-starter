import type { BaseReqConfig, BaseReqMethodConfig, Resolvable, Resp, RespErrInterceptorError } from '@jl-org/http'
import { Http } from '@jl-org/http'
import { getLocalStorage, setLocalStorage } from '@jl-org/tool'
import { CLIENT_INFO_KEY } from './constants'
import type { Resp as MyResp } from './types/Resp'
import type { JwtRefreshResponse, UserInfoResponse } from './UserApi'
import { UserApi } from './UserApi'

const DEFAULT_AUTH_CODES: AuthCodes = {
  refresh: 4006,
  logout: 4100,
}

/** 创建请求实例时选择的凭证模式。 */
export type AuthMode = 'session' | 'anonymous'

/** 需要由共享层识别的认证响应码。 */
export interface AuthCodes {
  /** access 凭证失效，需要刷新并重放请求。 */
  refresh: number
  /** 当前会话不可用，需要清理并通知调用方。 */
  logout: number
}

/** 应用层可附加到每个请求的头集合。 */
export type AppRequestHeaders = Record<string, string | number | boolean | null | undefined>

/** 默认错误拦截器交给应用层的业务错误信息。 */
export interface BizErrorInfo {
  code: number
  msg?: string
  data?: unknown
  traceId?: string
}

/** 诊断事件的安全结构化字段。 */
export type HttpDiagnosticMeta = Record<string, number | string | boolean | undefined>

/** HTTP 共享层对外暴露的生命周期事件。 */
export type HttpDiagnosticEvent =
  | 'auth.access-expired'
  | 'auth.not-authenticated'
  | 'token-refresh.started'
  | 'token-refresh.joined'
  | 'token-refresh.succeeded'
  | 'token-refresh.failed'
  | 'request-replay.started'
  | 'request-replay.succeeded'
  | 'request-replay.failed'

/** 诊断事件回调。 */
export type HttpDiagnosticEventHandler = (
  event: HttpDiagnosticEvent,
  meta: HttpDiagnosticMeta,
) => void

/** 业务请求可以携带的共享层上下文。 */
export type HttpRequestConfig = Omit<BaseReqMethodConfig, 'headers'> & {
  url?: string
  headers?: Record<string, unknown>
  traceId?: string
  __skipBizError?: boolean
  __isRefreshRequest?: boolean
  __isRetry?: boolean
  __baseUrlSnapshot?: string
  __requestUrlSnapshot?: string
  __sessionSnapshot?: UserSessionSnapshot | null
}

/** 带业务 Trace ID 的请求配置。 */
export type TraceRequestConfig = BaseReqMethodConfig & {
  traceId?: string
}

/** HTTP 实例配置选项。 */
export interface HttpInstanceConfig {
  /**
   * 请求鉴权模式
   *
   * @default 'session'
   */
  authMode?: AuthMode
  /**
   * 认证响应码；未提供的字段使用 4006 / 4100
   *
   * @default { refresh: 4006, logout: 4100 }
   */
  authCodes?: Partial<AuthCodes>
  /**
   * API 基础 URL；函数会在每次请求发起时求值
   *
   * @default ''
   */
  baseUrl?: Resolvable<string>
  /**
   * 请求超时时间，单位为毫秒；-1 表示不限制
   *
   * @default -1
   */
  timeout?: number
  /** 响应拦截器。 */
  respInterceptor?: (response: Resp<MyResp>) => unknown
  /** 请求拦截器。 */
  reqInterceptor?: (config: HttpRequestConfig) => HttpRequestConfig | Promise<HttpRequestConfig>
  /** 错误拦截器；传入后由调用方接管默认错误处理。 */
  respErrInterceptor?: (error: RespErrInterceptorError) => unknown
  /** 应用运行时请求头。 */
  getAppHeaders?: () => AppRequestHeaders
  /** 安全诊断事件回调。 */
  onDiagnosticEvent?: HttpDiagnosticEventHandler
  /** 非认证业务错误回调。 */
  onBizError?: (info: BizErrorInfo) => void
  /** 会话失效回调。 */
  onUnauthorized?: (error: unknown) => void
}

/** HTTP 实例类型。 */
export type HttpInstance = ReturnType<typeof createHttpInstance>

/** 创建带通用响应、请求和鉴权行为的 HTTP 实例。 */
export function createHttpInstance(config: HttpInstanceConfig = {}) {
  const {
    authMode = 'session',
    authCodes: authCodeOverrides,
    baseUrl = '',
    timeout = -1,
    respInterceptor,
    reqInterceptor,
    respErrInterceptor,
    getAppHeaders,
    onDiagnosticEvent,
    onBizError,
    onUnauthorized,
  } = config
  const authCodes: AuthCodes = {
    refresh: authCodeOverrides?.refresh ?? DEFAULT_AUTH_CODES.refresh,
    logout: authCodeOverrides?.logout ?? DEFAULT_AUTH_CODES.logout,
  }
  const usesSessionAuth = authMode === 'session'

  let http: Http | null = null
  let userApi: UserApi | null = null
  let refreshPromise: Promise<RefreshResult> | null = null
  let refreshSnapshot: RefreshRequestSnapshot | null = null

  const emitDiagnosticEvent = (event: HttpDiagnosticEvent, meta: HttpDiagnosticMeta = {}) => {
    try {
      if (usesSessionAuth) {
        onDiagnosticEvent?.(event, meta)
      }
    }
    catch {
      /** 诊断回调不得影响请求主链 */
    }
  }

  const notifyUnauthorized = (error: unknown) => {
    try {
      onUnauthorized?.(error)
    }
    catch (callbackError) {
      console.warn('Unauthorized callback failed:', callbackError)
    }
  }

  const readErrorResponse = async (rawResp: unknown): Promise<ErrorBody | undefined> => {
    if (!(rawResp instanceof Response)) {
      return undefined
    }

    if (rawResp.bodyUsed || rawResp.body?.locked) {
      return undefined
    }

    try {
      const data = await rawResp.clone().json()
      return isErrorBody(data)
        ? data
        : undefined
    }
    catch (jsonError) {
      console.log('Failed to parse error response json:', jsonError)
      return undefined
    }
  }

  const defaultRespErrInterceptor = async (error: RespErrInterceptorError): Promise<unknown> => {
    const { rawResp, request, error: requestError } = error
    const requestConfig = request as InternalRequestConfig
    const data = await readErrorResponse(rawResp)

    if (requestConfig.__isRefreshRequest) {
      const refreshError = createResponseError(
        data,
        requestError,
        'Token refresh request failed',
      )
      return Promise.reject(refreshError)
    }

    if (usesSessionAuth && data?.code === authCodes.refresh) {
      const staleRequestError = getStaleRequestSessionError(requestConfig)
      if (staleRequestError) {
        return Promise.reject(staleRequestError)
      }

      emitDiagnosticEvent('auth.access-expired', {
        ...getSafeRequestMeta(request),
        code: data.code,
      })

      if (requestConfig.__isRetry) {
        const retryError = createCodedError('Token refresh retry failed', authCodes.refresh)
        notifyUnauthorized(retryError)
        return Promise.reject(retryError)
      }

      try {
        const requestSnapshot = resolveRefreshRequestSnapshot(getRefreshRequestSnapshot(requestConfig))
        const refreshResult = await refreshAccessToken(requestSnapshot)
        assertRefreshResultCanReplay(refreshResult.context, refreshResult.userInfo, requestSnapshot)
        if (!http) {
          throw new Error('HTTP instance is not initialized')
        }

        return retryWithRefreshedToken(
          http,
          requestConfig,
          refreshResult.userInfo,
          authCodes.refresh,
          emitDiagnosticEvent,
        )
      }
      catch (refreshError) {
        if (shouldLogoutOnRefreshError(refreshError, authCodes)) {
          notifyUnauthorized(refreshError)
        }
        return Promise.reject(refreshError)
      }
    }

    if (usesSessionAuth && data?.code === authCodes.logout) {
      const staleRequestError = getStaleRequestSessionError(requestConfig)
      if (staleRequestError) {
        return Promise.reject(staleRequestError)
      }

      emitDiagnosticEvent('auth.not-authenticated', {
        ...getSafeRequestMeta(request),
        code: data.code,
      })
      clearAuthStorage()
      const unauthorizedError = createCodedError(
        data.msg || 'Unauthorized',
        data.code,
      )
      notifyUnauthorized(unauthorizedError)
      return Promise.reject(unauthorizedError)
    }

    if (
      typeof data?.code === 'number'
      && !requestConfig.__skipBizError
    ) {
      onBizError?.({
        code: data.code,
        msg: data.msg,
        data: data.data,
        traceId: getHeaderValue(requestConfig.headers, 'X-Trace-Id'),
      })
    }

    if (data?.msg) {
      return Promise.reject(createCodedError(data.msg, data.code))
    }

    return Promise.reject(requestError)
  }

  http = new Http({
    baseUrl,
    timeout,
    fetchOption: {
      credentials: 'omit',
    },
    respInterceptor: async (response: Resp<MyResp>) => {
      const body = response.data

      if (respInterceptor) {
        return respInterceptor(response)
      }

      return body?.data
    },
    reqInterceptor: async (requestConfig) => {
      const request = requestConfig as HttpRequestConfig
      request.headers = request.headers || {}

      if (usesSessionAuth) {
        let sessionSnapshot: UserSessionSnapshot | null | undefined
        try {
          const clientInfo = readClientInfo()
          sessionSnapshot = createUserSessionSnapshot(clientInfo)
          const accessToken = clientInfo?.jwt.access
          const clientId = clientInfo?.id

          if (accessToken) {
            request.headers.Authorization = `Bearer ${accessToken}`
          }

          if (clientId) {
            request.headers['x-client-id'] = clientId
          }
        }
        catch (storageError) {
          sessionSnapshot = null
          console.warn('Failed to attach auth headers from localStorage:', storageError)
        }
        request.__sessionSnapshot = sessionSnapshot
      }

      try {
        applyHeaders(request.headers, getAppHeaders?.())
      }
      catch (headerError) {
        console.warn('Failed to attach app headers:', headerError)
      }

      const explicitBaseUrl = typeof request.baseUrl === 'string'
        ? request.baseUrl
        : undefined
      request.__baseUrlSnapshot = explicitBaseUrl
      request.__requestUrlSnapshot = (request as InternalRequestConfig).url

      const interceptedRequest = reqInterceptor
        ? await reqInterceptor(request)
        : request
      interceptedRequest.__baseUrlSnapshot = explicitBaseUrl
      interceptedRequest.__requestUrlSnapshot = (request as InternalRequestConfig).url
      interceptedRequest.__sessionSnapshot = request.__sessionSnapshot
      return interceptedRequest
    },
    respErrInterceptor: respErrInterceptor || defaultRespErrInterceptor,
  })

  if (usesSessionAuth) {
    userApi = new UserApi(http)
  }

  return http

  async function refreshAccessToken(snapshot?: RefreshRequestSnapshot): Promise<RefreshResult> {
    if (!usesSessionAuth || !userApi) {
      const error = createCodedError('UserApi is not initialized', authCodes.refresh)
      emitDiagnosticEvent('token-refresh.failed', { code: error.code })
      throw error
    }

    const resolvedSnapshot = resolveRefreshRequestSnapshot(snapshot)
    if (refreshPromise) {
      if (
        refreshSnapshot
        && !areRefreshRequestSnapshotsCompatible(refreshSnapshot, resolvedSnapshot)
      ) {
        const error = createStaleRefreshError('Refresh context changed during concurrent refresh')
        emitDiagnosticEvent('token-refresh.failed', { code: error.code })
        throw error
      }

      emitDiagnosticEvent('token-refresh.joined')
      return refreshPromise
    }

    emitDiagnosticEvent('token-refresh.started')
    const currentPromise = performRefresh(resolvedSnapshot)
    refreshPromise = currentPromise
    refreshSnapshot = resolvedSnapshot

    try {
      return await currentPromise
    }
    finally {
      if (refreshPromise === currentPromise) {
        refreshPromise = null
        refreshSnapshot = null
      }
    }
  }

  async function performRefresh(snapshot?: RefreshRequestSnapshot): Promise<RefreshResult> {
    let context: RefreshContext | undefined

    try {
      const stored = readClientInfo()
      const refreshToken = stored?.jwt.refresh
      const currentBaseUrl = snapshot?.resolvedBaseUrl ?? resolveValue(baseUrl)
      const refreshBaseUrl = snapshot?.baseUrl ?? currentBaseUrl

      if (
        snapshot?.baseUrl === undefined
        && snapshot?.requestUrl !== undefined
        && !isRequestFromBase(snapshot.requestUrl, currentBaseUrl)
      ) {
        throw createStaleRefreshError('Base URL changed before refresh started')
      }

      if (!stored || !refreshToken) {
        throw createCodedError(
          'Missing refresh token or invalid local session',
          authCodes.refresh,
        )
      }

      context = {
        baseUrl: normalizeBaseUrl(refreshBaseUrl),
        refreshToken,
        userId: stored.id,
        email: stored.email,
        checkInstanceBaseUrl: snapshot?.baseUrl === undefined,
      }
      const newJwt = await userApi!.refreshToken(refreshToken, {
        baseUrl: refreshBaseUrl,
      })

      if (!isValidJwt(newJwt)) {
        throw createCodedError('Refresh response is invalid', authCodes.refresh)
      }

      assertRefreshContextCurrent(context)

      const newUserInfo: UserInfoResponse = {
        ...stored,
        jwt: newJwt,
      }

      try {
        setLocalStorage(CLIENT_INFO_KEY, newUserInfo)
      }
      catch (storageError) {
        console.warn('Failed to save refreshed token to storage:', storageError)
        throw storageError instanceof Error
          ? storageError
          : new Error('Failed to save refreshed token to storage')
      }

      emitDiagnosticEvent('token-refresh.succeeded')
      return { context, userInfo: newUserInfo }
    }
    catch (error) {
      const refreshError = context && !isRefreshContextCurrent(context)
        ? createStaleRefreshError('Session or base URL changed during refresh')
        : error
      emitDiagnosticEvent('token-refresh.failed', {
        code: getErrorCode(refreshError),
      })
      throw refreshError
    }
  }

  function assertRefreshContextCurrent(context: RefreshContext) {
    if (!isRefreshContextCurrent(context)) {
      throw createStaleRefreshError('Session or base URL changed during refresh')
    }
  }

  function isRefreshContextCurrent(context: RefreshContext): boolean {
    const current = readClientInfo()
    const currentBaseUrl = context.checkInstanceBaseUrl
      ? normalizeBaseUrl(resolveValue(baseUrl))
      : context.baseUrl
    const sameIdentity = current
      && current.jwt.refresh === context.refreshToken
      && current.id === context.userId
      && current.email === context.email

    return Boolean(sameIdentity && currentBaseUrl === context.baseUrl)
  }

  function assertRefreshResultCanReplay(
    context: RefreshContext,
    refreshedUser: UserInfoResponse,
    requestSnapshot: RefreshRequestSnapshot,
  ) {
    const requestBaseUrl = getRefreshContextBase(requestSnapshot)
    const requestSession = requestSnapshot.session
    const refreshSession: UserSessionSnapshot = {
      userId: context.userId,
      email: context.email,
      refreshToken: context.refreshToken,
    }
    const requestMatchesRefresh = (requestBaseUrl === undefined || requestBaseUrl === context.baseUrl)
      && (requestSession === undefined || areSessionSnapshotsEqual(requestSession, refreshSession))
    const current = readClientInfo()
    const currentBaseUrl = context.checkInstanceBaseUrl
      ? normalizeBaseUrl(resolveValue(baseUrl))
      : context.baseUrl
    const sameIdentity = current
      && current.id === context.userId
      && current.email === context.email
    const currentRefreshToken = current?.jwt.refresh
    const sameRefreshToken = currentRefreshToken === context.refreshToken
      || currentRefreshToken === refreshedUser.jwt.refresh

    if (!requestMatchesRefresh || !sameIdentity || !sameRefreshToken || currentBaseUrl !== context.baseUrl) {
      throw createStaleRefreshError('Session or base URL changed before request replay')
    }
  }

  function resolveRefreshRequestSnapshot(snapshot: RefreshRequestSnapshot = {}): RefreshRequestSnapshot {
    if (snapshot.baseUrl !== undefined || snapshot.resolvedBaseUrl !== undefined) {
      return snapshot
    }

    return {
      ...snapshot,
      resolvedBaseUrl: normalizeBaseUrl(resolveValue(baseUrl)),
    }
  }
}

/** 校验用户缓存中需要参与鉴权的 JWT 字段。 */
function isValidUserInfo(value: unknown): value is UserInfoResponse {
  if (!value || typeof value !== 'object') {
    return false
  }

  const jwt = (value as Partial<UserInfoResponse>).jwt
  return isValidJwt(jwt)
}

/** 校验刷新接口返回的 JWT。 */
function isValidJwt(value: unknown): value is JwtRefreshResponse {
  if (!value || typeof value !== 'object') {
    return false
  }

  const jwt = value as Partial<JwtRefreshResponse>
  return typeof jwt.access === 'string' && typeof jwt.refresh === 'string'
}

/** 读取并校验本地用户缓存。 */
function readClientInfo(): UserInfoResponse | null {
  try {
    const stored = getLocalStorage<UserInfoResponse | null>(CLIENT_INFO_KEY)

    if (isValidUserInfo(stored)) {
      return stored
    }

    if (stored) {
      localStorage.removeItem(CLIENT_INFO_KEY)
    }
  }
  catch (error) {
    console.warn('Failed to parse client info from localStorage:', error)
  }

  return null
}

/** 使用刷新后的 access token 重放一次原始请求。 */
async function retryWithRefreshedToken(
  http: Http,
  originalRequest: InternalRequestConfig,
  latestUserInfo: UserInfoResponse,
  refreshCode: number,
  emitDiagnosticEvent: HttpDiagnosticEventHandler,
): Promise<unknown> {
  if (originalRequest.__isRetry) {
    throw createCodedError('Token refresh retry failed', refreshCode)
  }

  const {
    url,
    method = 'GET',
    body,
    headers = {},
    ...restConfig
  } = originalRequest

  if (!url) {
    throw new Error('Original request URL is missing')
  }

  const retryHeaders = {
    ...headers,
    Authorization: `Bearer ${latestUserInfo.jwt.access}`,
  }
  const retryConfig: HttpRequestConfig = {
    ...restConfig,
    baseUrl: '',
    __baseUrlSnapshot: '',
    headers: retryHeaders,
    __isRetry: true,
  }
  const methodLower = String(method).toLowerCase()
  const requestMethod = (http as unknown as Record<string, (...args: any[]) => Promise<unknown>>)[methodLower]

  if (typeof requestMethod !== 'function') {
    throw new Error(`Unsupported HTTP method: ${method}`)
  }

  const requestMeta = getSafeRequestMeta(originalRequest)
  emitDiagnosticEvent('request-replay.started', requestMeta)

  try {
    const result = methodLower === 'get' || methodLower === 'head'
      ? await requestMethod.call(http, url, retryConfig)
      : await requestMethod.call(http, url, body, retryConfig)
    emitDiagnosticEvent('request-replay.succeeded', requestMeta)
    return result
  }
  catch (error) {
    emitDiagnosticEvent('request-replay.failed', {
      ...requestMeta,
      code: getErrorCode(error),
    })
    throw error
  }
}

/** 只有认证错误码才允许刷新失败触发登出。 */
function shouldLogoutOnRefreshError(error: unknown, authCodes?: AuthCodes): boolean {
  const code = getErrorCode(error)
  return code === (authCodes?.refresh ?? DEFAULT_AUTH_CODES.refresh)
    || code === (authCodes?.logout ?? DEFAULT_AUTH_CODES.logout)
}

/** 从错误对象读取可安全上报的错误码。 */
function getErrorCode(error: unknown): number | string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code
  return typeof code === 'number' || typeof code === 'string'
    ? code
    : undefined
}

/** 清理当前会话缓存。 */
function clearAuthStorage() {
  try {
    localStorage.removeItem(CLIENT_INFO_KEY)
  }
  catch (error) {
    console.warn('Failed to clear auth storage:', error)
  }
}

/** 读取相对请求路径，避免把敏感请求信息写入诊断数据。 */
function getSafeRequestMeta(request: unknown): HttpDiagnosticMeta {
  const value = request as { method?: unknown; url?: unknown } | null | undefined
  const rawUrl = typeof value?.url === 'string'
    ? value.url
    : ''

  return {
    method: typeof value?.method === 'string'
      ? value.method.toUpperCase()
      : undefined,
    pathname: getSafePathname(rawUrl),
  }
}

function getSafePathname(value: string): string | undefined {
  if (!value) {
    return undefined
  }

  try {
    return new URL(value, 'https://invalid.local').pathname
  }
  catch {
    return undefined
  }
}

function getRefreshRequestSnapshot(request: InternalRequestConfig): RefreshRequestSnapshot {
  return {
    baseUrl: request.__baseUrlSnapshot,
    requestUrl: request.__requestUrlSnapshot || request.url,
    session: request.__sessionSnapshot,
  }
}

function getStaleRequestSessionError(request: InternalRequestConfig): CodedError | undefined {
  const requestSession = request.__sessionSnapshot
  if (requestSession === undefined) {
    return undefined
  }

  const currentSession = createUserSessionSnapshot(readClientInfo())
  return areSessionSnapshotsEqual(requestSession, currentSession)
    ? undefined
    : createStaleRefreshError('Session changed while request was in flight')
}

function createUserSessionSnapshot(userInfo: UserInfoResponse | null): UserSessionSnapshot | null {
  if (!userInfo) {
    return null
  }

  return {
    userId: userInfo.id,
    email: userInfo.email,
    refreshToken: userInfo.jwt.refresh,
  }
}

function areSessionSnapshotsEqual(
  left: UserSessionSnapshot | null | undefined,
  right: UserSessionSnapshot | null | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right
  }

  if (left === null || right === null) {
    return left === right
  }

  return left.userId === right.userId
    && left.email === right.email
    && left.refreshToken === right.refreshToken
}

function getRefreshContextBase(snapshot: RefreshRequestSnapshot): string | undefined {
  if (snapshot.baseUrl !== undefined) {
    return normalizeBaseUrl(snapshot.baseUrl)
  }

  if (snapshot.resolvedBaseUrl !== undefined) {
    return normalizeBaseUrl(snapshot.resolvedBaseUrl)
  }

  return undefined
}

function areRefreshRequestSnapshotsCompatible(
  left: RefreshRequestSnapshot,
  right: RefreshRequestSnapshot,
): boolean {
  return getRefreshContextBase(left) === getRefreshContextBase(right)
    && areSessionSnapshotsEqual(left.session, right.session)
}

function resolveValue(value: Resolvable<string>): string {
  return typeof value === 'function'
    ? value()
    : value
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function isRequestFromBase(requestUrl: string, baseUrl: string): boolean {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  if (!normalizedBaseUrl) {
    return requestUrl.startsWith('/')
  }

  return requestUrl === normalizedBaseUrl
    || requestUrl.startsWith(`${normalizedBaseUrl}/`)
}

function applyHeaders(headers: Record<string, unknown>, values?: AppRequestHeaders) {
  if (!values) {
    return
  }

  for (const [key, value] of Object.entries(values)) {
    if (value == null || value === '') {
      continue
    }
    headers[key] = String(value)
  }
}

function getHeaderValue(headers: unknown, name: string): string | undefined {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(name) || undefined
  }

  if (Array.isArray(headers)) {
    const entry = headers.find((item) => (
      Array.isArray(item)
      && typeof item[0] === 'string'
      && item[0].toLowerCase() === name.toLowerCase()
    ))
    return typeof entry?.[1] === 'string'
      ? entry[1]
      : undefined
  }

  if (!headers || typeof headers !== 'object') {
    return undefined
  }

  const entry = Object.entries(headers)
    .find(([key]) => key.toLowerCase() === name.toLowerCase())
  return typeof entry?.[1] === 'string'
    ? entry[1]
    : undefined
}

function createCodedError(message: string, code?: number | string): CodedError {
  const error = new Error(message) as CodedError
  if (code !== undefined) {
    error.code = code
  }
  return error
}

function createResponseError(
  data: ErrorBody | undefined,
  fallback: unknown,
  fallbackMessage: string,
): unknown {
  if (data?.msg || data?.code !== undefined) {
    return createCodedError(data.msg || fallbackMessage, data.code)
  }
  return fallback
}

function createStaleRefreshError(message: string): CodedError {
  const error = createCodedError(message, 'STALE_REFRESH')
  error.name = 'StaleRefreshError'
  return error
}

function isErrorBody(value: unknown): value is ErrorBody {
  if (!value || typeof value !== 'object') {
    return false
  }

  const body = value as Partial<ErrorBody>
  return (
    typeof body.code === 'number'
    || typeof body.msg === 'string'
    || Object.prototype.hasOwnProperty.call(body, 'data')
  )
}

type CodedError = Error & { code?: number | string }
type ErrorBody = {
  code?: number
  msg?: string
  data?: unknown
}
type InternalRequestConfig = BaseReqConfig & HttpRequestConfig
type RefreshContext = {
  baseUrl: string
  refreshToken: string
  userId?: number
  email?: string
  checkInstanceBaseUrl: boolean
}
type UserSessionSnapshot = {
  userId?: number
  email?: string
  refreshToken: string
}
type RefreshRequestSnapshot = {
  baseUrl?: string
  requestUrl?: string
  resolvedBaseUrl?: string
  session?: UserSessionSnapshot | null
}
type RefreshResult = {
  context: RefreshContext
  userInfo: UserInfoResponse
}

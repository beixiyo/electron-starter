import type { BaseReqConfig, Resp, RespErrInterceptorError } from '@jl-org/http'
import type { Resp as MyResp } from './types/Resp'
import type { JwtRefreshResponse, UserInfoResponse } from './UserApi'
import { Http } from '@jl-org/http'
import { getLocalStorage, setLocalStorage } from '@jl-org/tool'
import { CLIENT_INFO_KEY } from './constants'
import { UserApi } from './UserApi'

/**
 * 创建 HTTP 实例
 *
 * @param config HTTP 实例配置选项
 * @returns HTTP 实例
 */
export function createHttpInstance(config: HttpInstanceConfig = {}) {
  const {
    baseUrl = '',
    respInterceptor,
    reqInterceptor,
    respErrInterceptor,
    onUnauthorized,
  } = config

  const http = new Http({
    baseUrl,
    timeout: -1,
    fetchOption: {
      credentials: 'omit',
    },
    /**
     * 统一响应拦截：
     * - 只做通用 data 提取和外部自定义处理
     * - 刷新 token / 登录失效处理放在 respErrInterceptor 中
     */
    respInterceptor: async (response: Resp<MyResp>) => {
      const body = response.data

      if (respInterceptor) {
        return respInterceptor(response)
      }

      return body?.data
    },

    reqInterceptor: (config) => {
      try {
        /** 访问 / 刷新 token（根据实际存储 key 名称调整） */
        const clientInfo = readClientInfo()
        const accessToken = clientInfo?.jwt.access
        const clientId = clientInfo?.id

        config.headers = config.headers || {}

        if (accessToken) {
          config.headers.Authorization = `Bearer ${accessToken}`
        }

        if (clientId) {
          config.headers['x-client-id'] = clientId
        }
      }
      catch (error) {
        console.warn('Failed to attach auth headers from localStorage:', error)
      }

      return reqInterceptor
        ? reqInterceptor(config)
        : config
    },

    respErrInterceptor: respErrInterceptor || (async (error: RespErrInterceptorError): Promise<any> => {
      const { rawResp, request } = error

      if (rawResp instanceof Response) {
        let data: any
        try {
          const cloned = rawResp.clone()
          data = await cloned.json()
        }
        catch (jsonError) {
          console.log('Failed to parse error response json:', jsonError)
        }

        // 4006: 刷新 token 并重放原始请求
        if (data?.code === 4006) {
          try {
            const latestUserInfo = await refreshAccessToken(onUnauthorized)
            return retryWithRefreshedToken(http, request, latestUserInfo)
          }
          catch (refreshError) {
            console.warn('Token refresh failed:', refreshError)
            onUnauthorized?.(refreshError)
            return Promise.reject(refreshError)
          }
        }

        // 4100: 退出登录 / 登录失效
        if (data?.code === 4100) {
          try {
            localStorage.removeItem(CLIENT_INFO_KEY)
          }
          catch (storageError) {
            console.warn('Failed to clear auth storage on unauthorized:', storageError)
          }

          const unauthorizedError = new Error(data?.msg || 'Unauthorized')
            ; (unauthorizedError as any).code = 4100

          onUnauthorized?.(unauthorizedError)
          return Promise.reject(unauthorizedError)
        }
      }

      console.warn(error)
      return Promise.reject(error)
    }),
  })

  userApi = new UserApi(http)

  return http
}

/**
 * 校验本地读取的用户信息是否符合预期结构
 */
function isValidUserInfo(value: unknown): value is UserInfoResponse {
  if (!value || typeof value !== 'object')
    return false

  const jwt = (value as Partial<UserInfoResponse>).jwt
  return Boolean(
    jwt
    && typeof jwt === 'object'
    && typeof jwt.access === 'string'
    && typeof jwt.refresh === 'string',
  )
}

/**
 * 从 localStorage 读取并校验客户端信息
 */
function readClientInfo(): UserInfoResponse | null {
  try {
    const stored = getLocalStorage<UserInfoResponse | null>(CLIENT_INFO_KEY)

    if (isValidUserInfo(stored))
      return stored

    if (stored) {
      /** 数据结构异常时主动清理，避免后续逻辑继续使用坏数据 */
      localStorage.removeItem(CLIENT_INFO_KEY)
    }
  }
  catch (error) {
    console.warn('Failed to parse client info from localStorage:', error)
  }

  return null
}

let userApi: UserApi | null = null
let refreshPromise: Promise<UserInfoResponse> | null = null

/**
 * 刷新 access token，并更新本地缓存
 */
async function refreshAccessToken(onUnauthorized?: (error: any) => void): Promise<UserInfoResponse> {
  if (!userApi) {
    const error = new Error('UserApi 未初始化，无法刷新 Token')
    console.warn(error)
    onUnauthorized?.(error)
    throw error
  }

  if (refreshPromise)
    return refreshPromise

  refreshPromise = (async () => {
    const stored = readClientInfo()
    const refreshToken = stored?.jwt.refresh

    if (!stored || !refreshToken) {
      const error = new Error('缺少刷新令牌或本地缓存损坏')
        ; (error as any).code = 4006
      onUnauthorized?.(error)
      throw error
    }

    let newJwt: JwtRefreshResponse
    try {
      newJwt = await userApi!.refreshToken(refreshToken)
    }
    catch (error) {
      console.warn('Token refresh request failed:', error)
      onUnauthorized?.(error)
      throw error
    }

    const newUserInfo: UserInfoResponse = {
      ...stored,
      jwt: newJwt,
    }

    try {
      setLocalStorage(CLIENT_INFO_KEY, newUserInfo)
    }
    catch (error) {
      console.warn('Failed to save refreshed token to storage:', error)
    }

    return newUserInfo
  })()

  try {
    return await refreshPromise
  }
  finally {
    refreshPromise = null
  }
}

/**
 * 使用刷新后的 token 重放原始请求
 */
async function retryWithRefreshedToken(
  http: Http,
  originalRequest: BaseReqConfig & { __isRetry?: boolean },
  latestUserInfo: UserInfoResponse,
): Promise<any> {
  /** 防止无限重试：如果已经是重试请求仍然返回 4006，则直接抛错 */
  if (originalRequest.__isRetry) {
    const error = new Error('Token 刷新后重试仍失败')
      ; (error as any).code = 4006
    throw error
  }

  const {
    url,
    method = 'GET',
    body,
    headers = {},
    ...restConfig
  } = originalRequest

  if (!url) {
    const error = new Error('缺少原始请求 URL，无法重试请求')
    throw error
  }

  const retryHeaders = {
    ...headers,
    Authorization: `Bearer ${latestUserInfo.jwt.access}`,
  }

  const retryConfig: any = {
    ...restConfig,
    headers: retryHeaders,
    __isRetry: true,
  }

  const methodLower = String(method).toLowerCase()
  const formatUrl = url.includes('/api/api')
    ? url.replace('/api', '')
    : url

  if (methodLower === 'get' || methodLower === 'head') {
    return http[methodLower](formatUrl, retryConfig)
  }

  return (http as any)[methodLower](formatUrl, body, retryConfig)
}

/**
 * HTTP 实例类型
 */
export type HttpInstance = ReturnType<typeof createHttpInstance>

/**
 * HTTP 实例配置选项
 */
export interface HttpInstanceConfig {
  /**
   * API 基础 URL
   */
  baseUrl?: string
  /**
   * 请求超时时间
   */
  timeout?: number
  /**
   * 响应拦截器
   */
  respInterceptor?: (response: Resp<MyResp>) => any
  /**
   * 请求拦截器
   */
  reqInterceptor?: (config: any) => any
  /**
   * 错误拦截器
   */
  respErrInterceptor?: (error: RespErrInterceptorError) => Promise<any>
  onUnauthorized?: (error: any) => void
}

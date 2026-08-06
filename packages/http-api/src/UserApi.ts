import type { HttpInstance } from './httpInstance'

export class UserApi {
  constructor(private http: HttpInstance) { }

  /**
   * 邮箱登录
   */
  async loginByEmail(data: {
    email: string
    captcha: string
    clientName: string
    osVersion: string
    clientModelName: string
  }): Promise<UserInfoResponse> {
    const url = '/account/login'
    return this.http.post(url, {
      login_name: data.email,
      captcha: data.captcha,
      client_name: data.clientName,
      os_version: data.osVersion,
      client_model_name: data.clientModelName,
    })
  }

  /**
   * 获取邮箱验证码（用于登录）
   */
  async getVerificationCode(data: { email: string }): Promise<unknown> {
    const url = '/account/captcha'
    return this.http.post(url, {
      email: data.email,
    })
  }

  /**
   * 第三方登录（Apple/Google）
   * 注意：需要在外部获取 authorizationCode，再传入本方法
   */
  async oauthLogin(data: OauthLoginParams): Promise<UserInfoResponse> {
    const url = '/account/oauth_login'
    return this.http.post(url, {
      authorization_code: data.authorization_code,
      state: data.state,
      client_name: data.client_name,
      os_version: data.os_version,
      client_model_name: data.client_model_name,
      platform: data.platform,
      client_type: data.client_type ?? 1,
      username: data.username,
    })
  }

  /**
   * 获取当前登录用户信息
   * @returns 用户信息；若未登录，服务端应返回 401
   */
  async getProfile(): Promise<UserInfoResponse> {
    const url = '/user/profile'
    return this.http.get(url)
  }

  /**
   * 注销账号（删除用户资料）
   * @returns 删除结果
   */
  async deleteProfile(): Promise<{ code: number, msg: string }> {
    const url = '/user/profile'
    return this.http.delete(url)
  }

  /**
   * 刷新 JWT Token
   */
  async refreshToken(refresh: string): Promise<JwtRefreshResponse> {
    const url = '/account/jwt_refresh'
    return this.http.post(url, { refresh })
  }

  /**
   * 退出客户端登录
   * @param clientId 客户端 ID（可选）
   */
  async logout(clientId?: number): Promise<{ code: number, msg: string }> {
    const url = '/client'
    if (clientId) {
      return this.http.delete(url, { query: { client_id: clientId } })
    }
    return this.http.delete(url)
  }
}

export enum ClientType {
  Web = 1,
  Desktop = 2,
}

export type OauthLoginParams = {
  authorization_code: string
  /** Provider 回传的 OAuth state；存在时原样交给后端 */
  state?: string
  client_name: string
  os_version: string
  client_model_name: string
  platform: 'apple' | 'google'
  client_type?: ClientType
  username?: string | null
}

/**
 * 用户信息响应
 */
export interface UserInfoResponse {
  id: number
  email: string
  username: string
  avatar: string
  client_info: {
    id: number
    client_name: string
    os_version: string
    last_active_time: string
  }
  jwt: JwtRefreshResponse
}

/**
 * 刷新 JWT token 响应
 */
export interface JwtRefreshResponse {
  access: string
  refresh: string
}

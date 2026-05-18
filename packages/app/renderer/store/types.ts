import type { ApiInstances, UserInfoResponse } from 'http-api'

/**
 * 用户信息响应类型
 */
export type { UserInfoResponse }

/**
 * UserActions 配置选项
 */
export interface UserActionsConfig {
  /**
   * API 实例（用于调用 logout 接口）
   */
  api: ApiInstances
  storageKey?: string
  /**
   * 自定义存储实现（可选，默认使用 localStorage）
   */
  storage?: {
    getItem: (key: string) => string | null
    setItem: (key: string, value: any) => void
    removeItem: (key: string) => void
  }
}

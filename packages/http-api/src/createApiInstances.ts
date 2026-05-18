import type { HttpInstance } from './httpInstance'
import { UserApi } from './UserApi'

/**
 * 创建所有 API 实例
 *
 * @param http HTTP 实例
 * @returns API 实例集合
 */
export function createApiInstances(http: HttpInstance) {
  return {
    user: new UserApi(http),
  }
}

/**
 * API 实例集合
 */
export type ApiInstances = ReturnType<typeof createApiInstances>

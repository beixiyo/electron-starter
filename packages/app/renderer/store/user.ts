import { api } from '@/api/httpInstance'
import { createUserActions } from './createUserActions'

/**
 * 创建 UserActions 实例（使用 electron 的 api 实例）
 */
export const UserActions = createUserActions({
  api,
})

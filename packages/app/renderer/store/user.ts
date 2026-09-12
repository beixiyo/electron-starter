import { api } from '@/http/httpInstance'
import { isElectron } from '@/utils/env'
import { createUserActions } from './createUserActions'

/**
 * 创建 UserActions 实例（使用 electron 的 api 实例）
 */
export const UserActions = createUserActions({
  api,
  onLogout: async () => {
    if (isElectron())
      await $ipc.session.clearHttpCache()
  },
})

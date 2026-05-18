import type { UserInfoResponse } from 'http-api'
import type { UserActionsConfig } from './types'
import { getLocalStorage, setLocalStorage } from '@jl-org/tool'
import { CLIENT_INFO_KEY } from 'http-api'

/**
 * 创建 UserActions 实例
 *
 * @param config 配置选项
 * @returns UserActions 实例
 */
export function createUserActions(config: UserActionsConfig) {
  const {
    api,
    storageKey = CLIENT_INFO_KEY,
    storage = {
      getItem: (key: string) => getLocalStorage<UserInfoResponse>(key),
      setItem: (key: string, value: any) => setLocalStorage(key, value),
      removeItem: (key: string) => {
        try {
          localStorage.removeItem(key)
        }
        catch (error) {
          console.warn('Failed to remove item from storage:', error)
        }
      },
    },
  } = config

  /**
   * 从存储获取用户信息
   */
  function getUserInfoFromStorage(): UserInfoResponse | null {
    try {
      const userInfoStr = storage.getItem(storageKey)
      if (!userInfoStr) {
        return null
      }
      return userInfoStr as UserInfoResponse
    }
    catch (error) {
      console.warn('Failed to get user info from storage:', error)
      return null
    }
  }

  return {
    /**
     * 登录成功
     */
    loggedIn(userInfo: UserInfoResponse) {
      /** 存入存储 */
      try {
        storage.setItem(storageKey, userInfo)
      }
      catch (error) {
        console.warn('Failed to save user info to storage:', error)
      }
    },

    /**
     * 退出登录
     */
    async logout() {
      try {
        /** 从存储获取用户信息 */
        const userInfo = getUserInfoFromStorage()
        const clientId = userInfo?.client_info?.id
        if (clientId) {
          /** 调用服务端 logout API */
          await api.user.logout(clientId)
        }
      }
      catch (error) {
        /** 即使 API 调用失败，也要清除本地存储 */
        console.warn('Logout API failed:', error)
      }
      finally {
        /** 清除存储 */
        try {
          storage.removeItem(storageKey)
        }
        catch (error) {
          console.warn('Failed to remove user info from storage:', error)
        }
      }
    },
  }
}

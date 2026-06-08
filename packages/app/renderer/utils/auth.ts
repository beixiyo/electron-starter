import { api } from '@/http/httpInstance'

/**
 * 调用服务端「当前用户」接口来判断是否已登录
 * - 已登录：返回 true
 * - 未登录或 401：返回 false
 */
export async function checkLogin(): Promise<boolean> {
  try {
    await api.user.getProfile()
    return true
  }
  catch (error: any) {
    /** 未登录通常返回 401，这里统一按未登录处理 */
    return false
  }
}

/**
 * 获取当前用户信息；未登录返回 null
 */
export async function fetchCurrentUser() {
  try {
    const user = await api.user.getProfile()
    return user
  }
  catch {
    return null
  }
}

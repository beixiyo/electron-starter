// @vitest-environment jsdom
/** 登出即使远端失败也必须清除本地凭证，并在之后清理宿主会话。 */
import type { ApiInstances } from 'http-api'
import { CLIENT_INFO_KEY } from 'http-api'
import { afterEach, expect, it, vi } from 'vitest'
import { createUserActions } from './createUserActions'

afterEach(() => {
  localStorage.removeItem(CLIENT_INFO_KEY)
  vi.restoreAllMocks()
})

it('远端登出失败后仍先移除凭证再执行会话清理，清理失败不阻止退出', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  localStorage.setItem(CLIENT_INFO_KEY, JSON.stringify({ client_info: { id: 7 } }))
  const logout = vi.fn().mockRejectedValue(new Error('offline'))
  const cleanup = vi.fn(() => {
    expect(localStorage.getItem(CLIENT_INFO_KEY)).toBeNull()
    throw new Error('cache unavailable')
  })
  const actions = createUserActions({
    api: { user: { logout } } as unknown as ApiInstances,
    onLogout: cleanup,
  })
  await expect(actions.logout()).resolves.toBeUndefined()
  expect(logout).toHaveBeenCalledWith(7)
  expect(cleanup).toHaveBeenCalledTimes(1)
})

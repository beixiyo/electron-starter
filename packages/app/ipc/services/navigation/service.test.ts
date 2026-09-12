/** 延迟建窗不能覆盖较新导航；首屏尚未订阅时必须仍可领取意图 */
import type { ServiceImpl } from '@ipc/core'
import type { NavigationContract } from './contract'
import { expect, it, vi } from 'vitest'
const harness = vi.hoisted(() => ({
  impl: null as ServiceImpl<NavigationContract> | null,
  emit: vi.fn(),
  ready: vi.fn(),
  window: { isDestroyed: () => false, webContents: { id: 7 }, focus: vi.fn() },
}))
vi.mock('@ipc/core', () => ({ createIpcService: (_name: string, impl: ServiceImpl<NavigationContract>) => {
  harness.impl = impl
  return { emit: harness.emit }
} }))
vi.mock('@main/main-window-opener', () => ({ ensureMainWindowReady: harness.ready }))
vi.mock('@main/window-manager', () => ({ windowManager: { get: () => harness.window, show: () => true } }))
import { openMainRoute } from './service'

it('较早建窗迟到时只保留新导航，且只有主窗口可领取', async () => {
  let finishFirst!: (window: unknown) => void
  harness.ready.mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve }))
  harness.ready.mockResolvedValue(harness.window)
  const first = openMainRoute('/recorder')
  expect(await openMainRoute('/shortcuts')).toBe(true)
  await expect(harness.impl!.mainHandle.takePendingRoute({ sender: { id: 99 } })).rejects.toThrow('main window')
  expect(await harness.impl!.mainHandle.takePendingRoute({ sender: { id: 7 } })).toBe('/shortcuts')
  expect(await harness.impl!.mainHandle.takePendingRoute({ sender: { id: 7 } })).toBeNull()
  finishFirst(harness.window)
  expect(await first).toBe(false)
  expect(harness.emit).toHaveBeenCalledOnce()
  expect(harness.emit).toHaveBeenCalledWith('openMainRoute', '/shortcuts', harness.window)
})

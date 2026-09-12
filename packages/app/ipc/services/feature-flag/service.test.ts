/** 验证跨进程写入权限和非法快照不会污染主进程开关。 */
import type { ServiceImpl } from '@ipc/core'
import type { FeatureFlagContract } from './contract'
import { expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({ impl: null as ServiceImpl<FeatureFlagContract> | null }))
vi.mock('@ipc/core/service', () => ({
  createIpcService: (_name: string, impl: ServiceImpl<FeatureFlagContract>) => {
    harness.impl = impl
    return {}
  },
}))
vi.mock('@main/window-manager', () => ({
  windowManager: { get: () => ({ isDestroyed: () => false, webContents: { id: 7 } }) },
}))
import './service'

it('只有主窗口能写入，非法载荷不覆盖已经同步的开关', () => {
  const handlers = harness.impl!.mainHandle
  handlers.sync({ sender: { id: 7 } }, { exampleEnabled: true })
  expect(() => handlers.sync({ sender: { id: 8 } }, { exampleEnabled: false })).toThrow('main window')
  expect(() => handlers.sync({ sender: { id: 7 } }, { exampleEnabled: 'false' } as unknown as Record<string, boolean>)).toThrow('Invalid')
  expect(handlers.getState({})).toEqual({ exampleEnabled: true })
  handlers.sync({ sender: { id: 7 } }, { exampleEnabled: false })
  expect(handlers.getState({})).toEqual({ exampleEnabled: false })
})

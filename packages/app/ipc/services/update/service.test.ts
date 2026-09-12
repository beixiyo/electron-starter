import type { ServiceImpl } from '@ipc/core'
import type { UpdateContract } from './contract'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  const listeners = new Map<string, (payload: unknown) => void>()
  const emitter = { emit: vi.fn() }
  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    disableDifferentialDownload: false,
    forceDevUpdateConfig: false,
    on: vi.fn((event: string, listener: (payload: unknown) => void) => {
      listeners.set(event, listener)
      return autoUpdater
    }),
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
  }

  return { listeners, emitter, autoUpdater, impl: null as ServiceImpl<UpdateContract> | null }
})

vi.mock('@ipc/core', () => ({
  createIpcService: vi.fn((_namespace: string, impl: ServiceImpl<UpdateContract>) => {
    harness.impl = impl
    return harness.emitter
  }),
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('@jl-org/tool/node', () => ({ loadEnv: vi.fn() }))
vi.mock('@main/storage', () => ({ getUpdaterCacheStorageAreaPath: () => '/tmp/update-cache' }))
vi.mock('electron', () => ({ app: { getVersion: () => '1.2.3' } }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: harness.autoUpdater } }))

describe('update IPC 错误边界', () => {
  beforeEach(() => {
    harness.listeners.clear()
    harness.emitter.emit.mockClear()
    harness.autoUpdater.on.mockClear()
  })

  it('主进程 updater error 只向 renderer 发分类码', async () => {
    const { initAutoUpdater } = await import('./service')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    initAutoUpdater({ initialCheckDelayMs: 0, pollIntervalMs: 0 })
    harness.listeners.get('error')?.(Object.assign(new Error('request failed for https://private.invalid'), {
      code: 'ECONNREFUSED',
    }))
    await Promise.resolve()

    expect(harness.emitter.emit).toHaveBeenCalledWith('status', {
      status: 'error',
      error: 'network',
    })
    expect(harness.emitter.emit.mock.calls.at(-1)?.[1]).not.toHaveProperty('message')
    expect(consoleError).toHaveBeenCalledWith('[update] auto updater error:', 'network')
    consoleError.mockRestore()
  })
})

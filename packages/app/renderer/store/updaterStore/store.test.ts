// @vitest-environment jsdom

import type { UpdateProgress, UpdateStatusEvent } from '@ipc/services/update/contract'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdaterStoreOptions } from './types'

const CURRENT_VERSION = '1.2.3'
const NEXT_VERSION = '1.3.0'

vi.mock('@/utils/env', () => ({
  isElectron: () => true,
}))

async function freshStore(options: UpdaterStoreOptions = {}) {
  vi.resetModules()

  const statusListeners: Array<(payload: UpdateStatusEvent) => void> = []
  const progressListeners: Array<(payload: UpdateProgress) => void> = []
  const ipc = {
    update: {
      getVersion: vi.fn(async () => CURRENT_VERSION),
      check: vi.fn(async () => ({ available: false })),
      download: vi.fn(async () => undefined),
      install: vi.fn(async () => undefined),
      on: vi.fn((event: string, listener: (payload: unknown) => void) => {
        if (event === 'status') statusListeners.push(listener as (payload: UpdateStatusEvent) => void)
        if (event === 'progress') progressListeners.push(listener as (payload: UpdateProgress) => void)
        return () => undefined
      }),
    },
  }

  vi.stubGlobal('$ipc', ipc)

  const store = await import('./store')
  store.initUpdaterStore(options)
  await flush()

  return {
    store,
    ipc,
    view: renderHook(() => store.useUpdaterState()),
    emitStatus: async (payload: UpdateStatusEvent) => {
      statusListeners.forEach((listener) => listener(payload))
      await flush()
    },
    emitProgress: async (payload: UpdateProgress) => {
      progressListeners.forEach((listener) => listener(payload))
      await flush()
    },
  }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve()
}

function availableEvent(version = NEXT_VERSION): UpdateStatusEvent {
  return { status: 'available', info: { version } }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('updaterStore 强制更新锁', () => {
  it('轮询 checking 和策略失败都保留强更锁，关闭请求不会隐藏弹窗', async () => {
    const checkPolicy = vi.fn()
      .mockResolvedValueOnce({ forceUpdate: true })
      .mockRejectedValueOnce(new Error('offline'))
    const { store, view, emitStatus } = await freshStore({ checkPolicy })

    await emitStatus(availableEvent())
    expect(checkPolicy).toHaveBeenCalledWith({
      currentVersion: CURRENT_VERSION,
      info: { version: NEXT_VERSION },
    })
    expect(view.result.current.forceUpdate).toBe(true)
    expect(view.result.current.modalOpen).toBe(true)

    await emitStatus({ status: 'checking' })
    expect(view.result.current.forceUpdate).toBe(true)
    act(() => store.closeUpdaterModal())
    expect(view.result.current.modalOpen).toBe(true)

    await emitStatus(availableEvent())
    expect(checkPolicy).toHaveBeenCalledTimes(2)
    expect(view.result.current.forceUpdate).toBe(true)
    act(() => store.closeUpdaterModal())
    expect(view.result.current.modalOpen).toBe(true)
  })

  it('没有注入策略时不自行判定强制更新，也静默处理普通更新', async () => {
    const { view, emitStatus } = await freshStore()

    await emitStatus(availableEvent())

    expect(view.result.current.forceUpdate).toBe(false)
    expect(view.result.current.modalOpen).toBe(false)
  })

  it('强更目标在轮询中消失时转为可重试错误而保持锁', async () => {
    const checkPolicy = vi.fn().mockResolvedValue({ forceUpdate: true })
    const { store, view, emitStatus } = await freshStore({ checkPolicy })

    await emitStatus(availableEvent())
    await emitStatus({ status: 'not-available' })

    expect(view.result.current.status).toBe('error')
    expect(view.result.current.error).toBe('unknown')
    expect(view.result.current.forceUpdate).toBe(true)
    expect(view.result.current.modalOpen).toBe(true)

    act(() => store.closeUpdaterModal())
    expect(view.result.current.modalOpen).toBe(true)
  })

  it('较新的策略响应会淘汰迟到的旧响应', async () => {
    let resolveFirst!: (value: { forceUpdate: boolean }) => void
    const checkPolicy = vi.fn(({ info }: { info: { version: string } }) => {
      if (info.version === NEXT_VERSION) {
        return new Promise<{ forceUpdate: boolean }>((resolve) => {
          resolveFirst = resolve
        })
      }
      return { forceUpdate: false }
    })
    const { view, emitStatus } = await freshStore({ checkPolicy })

    await emitStatus(availableEvent(NEXT_VERSION))
    await emitStatus({ status: 'checking' })
    await emitStatus(availableEvent('1.4.0'))
    expect(view.result.current.forceUpdate).toBe(false)

    resolveFirst({ forceUpdate: true })
    await flush()
    expect(view.result.current.forceUpdate).toBe(false)
  })
})

describe('updaterStore 普通更新展示策略', () => {
  it('自动弹窗在间隔内只出现一次，手动打开不消耗自动额度', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const { store, view, emitStatus } = await freshStore({
      autoOpenOnAvailable: true,
      autoPromptIntervalMs: 1000,
    })

    await emitStatus(availableEvent())
    expect(view.result.current.modalOpen).toBe(true)
    store.closeUpdaterModal()

    vi.setSystemTime(500)
    await emitStatus({ status: 'checking' })
    await emitStatus(availableEvent())
    expect(view.result.current.modalOpen).toBe(false)

    store.openUpdaterModal()
    await flush()
    expect(view.result.current.modalOpen).toBe(true)
    store.closeUpdaterModal()

    vi.setSystemTime(1001)
    await emitStatus({ status: 'checking' })
    await emitStatus(availableEvent())
    expect(view.result.current.modalOpen).toBe(true)
  })
})

describe('updaterStore 异步弹窗策略', () => {
  it('状态变为 not-available 后迟到的允许结果不会重开弹窗', async () => {
    const pending = deferred<boolean>()
    const canPrompt = vi.fn(() => pending.promise)
    const { view, emitStatus } = await freshStore({ canPrompt })

    await emitStatus(availableEvent())
    await emitStatus({ status: 'not-available' })
    pending.resolve(true)
    await flush()

    expect(view.result.current.status).toBe('not-available')
    expect(view.result.current.modalOpen).toBe(false)
  })

  it('用户关闭弹窗后迟到的允许结果不会再次打开弹窗', async () => {
    const pending = deferred<boolean>()
    const canPrompt = vi.fn(() => pending.promise)
    const { store, view, emitStatus } = await freshStore({ canPrompt })

    await emitStatus(availableEvent())
    act(() => store.closeUpdaterModal())
    pending.resolve(true)
    await flush()

    expect(view.result.current.modalOpen).toBe(false)
  })
})

describe('updaterStore IPC rejection', () => {
  it('检查调用没有收到主进程 error 事件时也不会一直停在 checking', async () => {
    const { store, ipc, view } = await freshStore()
    ipc.update.check.mockRejectedValueOnce(new Error('transport failed'))

    await store.checkUpdate()

    expect(view.result.current.status).toBe('error')
    expect(view.result.current.error).toBe('unknown')
  })

  it('下载和安装的拒绝不会覆盖主进程已经推送的分类错误', async () => {
    const download = deferred<undefined>()
    const install = deferred<undefined>()
    const { store, ipc, view, emitStatus } = await freshStore()
    ipc.update.download.mockReturnValueOnce(download.promise)
    ipc.update.install.mockReturnValueOnce(install.promise)

    store.downloadUpdate()
    await emitStatus({ status: 'error', error: 'network' })
    download.reject(new Error('transport failed'))
    await flush()
    expect(view.result.current.error).toBe('network')

    await emitStatus({ status: 'downloaded', info: { version: NEXT_VERSION } })
    store.installUpdate()
    await emitStatus({ status: 'error', error: 'verification' })
    install.reject(new Error('checksum failed'))
    await flush()
    expect(view.result.current.error).toBe('verification')
  })

  it('旧下载和安装拒绝不会覆盖后续操作的状态', async () => {
    const firstDownload = deferred<undefined>()
    const secondDownload = deferred<undefined>()
    const firstInstall = deferred<undefined>()
    const secondInstall = deferred<undefined>()
    const { store, ipc, view, emitStatus } = await freshStore()
    ipc.update.download
      .mockReturnValueOnce(firstDownload.promise)
      .mockReturnValueOnce(secondDownload.promise)
    ipc.update.install
      .mockReturnValueOnce(firstInstall.promise)
      .mockReturnValueOnce(secondInstall.promise)

    store.downloadUpdate()
    store.downloadUpdate()
    firstDownload.reject(new Error('stale download'))
    await flush()
    expect(view.result.current.status).toBe('downloading')
    expect(view.result.current.error).toBe(null)
    secondDownload.reject(new Error('current download'))
    await flush()
    expect(view.result.current.status).toBe('error')

    await emitStatus({ status: 'downloaded', info: { version: NEXT_VERSION } })
    store.installUpdate()
    await emitStatus({ status: 'downloaded', info: { version: NEXT_VERSION } })
    store.installUpdate()
    firstInstall.reject(new Error('stale install'))
    await flush()
    expect(view.result.current.status).toBe('downloaded')
    secondInstall.reject(new Error('current install'))
    await flush()
    expect(view.result.current.status).toBe('error')
  })
})

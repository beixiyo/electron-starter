import type { RequestHandler } from 'msw'
import { setupWorker } from 'msw/browser'
import { getMockConfig } from './config'
import type { MockConfig } from './config'

/** 同源开发 worker 的固定脚本路径。 */
export const MOCK_SERVICE_WORKER_PATH = '/mockServiceWorker.js'

/** 共享 worker；初始 handlers 为空，防止全关时恢复初始拦截。 */
export const worker = setupWorker()

let definitions: readonly MockEndpointDefinition[] = []
let workerStarted = false
let syncVersion = 0
let syncQueue: Promise<void> = Promise.resolve()
let unregisterPromise: Promise<void> | null = null
let runtimeStatus: MockRuntimeStatus = { state: 'idle' }
const statusListeners = new Set<() => void>()
const definitionListeners = new Set<() => void>()

/** 当前宿主声明的 endpoint 列表。 */
export function getMockDefinitions(): readonly MockEndpointDefinition[] {
  return definitions
}

/** 替换声明并按 id 去重；运行中使用入口模块的同名包装自动同步 worker。 */
export function setMockDefinitions(next: readonly MockEndpointDefinition[]): void {
  const seen = new Set<string>()
  definitions = next.filter((definition) => {
    if (!definition.id || seen.has(definition.id)) return false
    seen.add(definition.id)
    return true
  })
  definitionListeners.forEach((listener) => listener())
}

/** 订阅 endpoint 声明变化，返回取消订阅函数。 */
export function subscribeMockDefinitions(listener: () => void): () => void {
  definitionListeners.add(listener)
  return () => definitionListeners.delete(listener)
}

/** 根据当前场景选择构造启用的 handlers。 */
export function getEnabledMockHandlers(config: MockConfig = getMockConfig()): RequestHandler[] {
  return definitions.flatMap((definition) => {
    const selected = config.endpointScenarios[definition.id]
    if (!selected || selected === 'off') return []

    return definition.scenarios.find((scenario) => scenario.id === selected)?.handlers ?? []
  })
}

/** 供界面订阅的稳定运行状态快照。 */
export function getMockRuntimeStatus(): MockRuntimeStatus {
  return runtimeStatus
}

/** 订阅 worker 运行状态，返回取消订阅函数。 */
export function subscribeMockRuntimeStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

/** 串行同步最新配置，淘汰已过期的启停任务。 */
export function syncMockWorker(): Promise<void> {
  if (!import.meta.env.DEV) return Promise.resolve()

  const version = ++syncVersion
  const task = syncQueue.then(
    () => syncToLatest(version),
    () => syncToLatest(version),
  )
  syncQueue = task.catch(() => undefined)
  return task
}

/** 按当前配置启用 worker；没有启用场景时保持关闭。 */
export function startMockWorker(): Promise<void> {
  return syncMockWorker()
}

/** 停止拦截并注销本框架脚本，异步启停按队列顺序完成。 */
export function stopMockWorker(): Promise<void> {
  if (!import.meta.env.DEV) return Promise.resolve()

  const version = ++syncVersion
  const task = syncQueue.then(
    () => stopToLatest(version),
    () => stopToLatest(version),
  )
  syncQueue = task.catch(() => undefined)
  return task
}

function syncToLatest(version: number): Promise<void> {
  if (version !== syncVersion) return Promise.resolve()

  const supportError = getSupportError()
  if (supportError) {
    setRuntimeStatus({ state: 'unsupported', message: supportError })
    return Promise.resolve()
  }

  const handlers = getEnabledMockHandlers()
  if (handlers.length === 0) return stopToLatest(version)

  return startToLatest(version, handlers)
}

async function startToLatest(version: number, handlers: RequestHandler[]): Promise<void> {
  setRuntimeStatus({
    state: workerStarted
      ? 'running'
      : 'starting',
  })

  if (!workerStarted) {
    try {
      await worker.start({
        onUnhandledRequest: 'bypass',
        quiet: true,
        serviceWorker: { url: MOCK_SERVICE_WORKER_PATH },
      })
      workerStarted = true
    }
    catch (error) {
      if (version === syncVersion) {
        setRuntimeStatus({
          state: 'error',
          message: error instanceof Error
            ? error.message
            : 'Unable to start mock worker',
        })
      }
      throw error
    }
  }

  if (version !== syncVersion) return
  worker.resetHandlers(...handlers)
  setRuntimeStatus({ state: 'running' })
}

async function stopToLatest(version: number): Promise<void> {
  if (version !== syncVersion) return

  if (getSupportError()) {
    setRuntimeStatus({ state: 'unsupported', message: getSupportError()! })
    return
  }

  setRuntimeStatus({ state: 'stopping' })
  if (workerStarted) {
    worker.resetHandlers()
    worker.stop()
    workerStarted = false
  }

  try {
    await unregisterMockServiceWorker()
    if (version === syncVersion) setRuntimeStatus({ state: 'idle' })
  }
  catch (error) {
    if (version === syncVersion) {
      setRuntimeStatus({
        state: 'error',
        message: error instanceof Error
          ? error.message
          : 'Unable to stop mock worker',
      })
    }
    throw error
  }
}

async function unregisterMockServiceWorker(): Promise<void> {
  if (unregisterPromise) return unregisterPromise

  const current = (async () => {
    const registrations = await navigator.serviceWorker.getRegistrations()
    const expectedUrl = new URL(MOCK_SERVICE_WORKER_PATH, window.location.href).href

    await Promise.all(
      registrations
        .filter((registration) => {
          return [registration.active, registration.installing, registration.waiting]
            .some((serviceWorker) => serviceWorker?.scriptURL === expectedUrl)
        })
        .map((registration) => registration.unregister()),
    )
  })()

  unregisterPromise = current
  try {
    await current
  }
  finally {
    if (unregisterPromise === current) unregisterPromise = null
  }
}

function getSupportError(): string | undefined {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'Mock Service Worker requires a browser renderer'
  if (window.location.protocol === 'file:') return 'Mock Service Worker is unavailable on file:// pages'
  if (!navigator.serviceWorker) return 'Mock Service Worker is unavailable because Service Worker is unsupported'
  return undefined
}

function setRuntimeStatus(next: MockRuntimeStatus): void {
  const currentMessage = 'message' in runtimeStatus
    ? runtimeStatus.message
    : undefined
  const nextMessage = 'message' in next
    ? next.message
    : undefined
  if (runtimeStatus.state === next.state && currentMessage === nextMessage) return
  runtimeStatus = next
  statusListeners.forEach((listener) => listener())
}

/** 宿主注入的通用 endpoint 与可选场景。 */
export type MockEndpointDefinition = {
  id: string
  label: string
  scenarios: readonly MockScenarioDefinition[]
}

/** 一个可命名、可选择的 MSW handler 集合。 */
export type MockScenarioDefinition = {
  id: string
  label: string
  handlers: readonly RequestHandler[]
}

/** worker 生命周期及不支持或启动失败的原因。 */
export type MockRuntimeStatus =
  | { state: 'idle' | 'starting' | 'running' | 'stopping' }
  | { state: 'unsupported' | 'error'; message: string }

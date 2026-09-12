import { getMockRuntimeStatus, setMockDefinitions as setBrowserMockDefinitions, stopMockWorker, syncMockWorker } from './browser'
import type { MockEndpointDefinition } from './browser'
import type { MockConfig } from './config'
import { getMockConfig, setMockConfig, subscribeMockConfig } from './config'
import { installMockDevtools } from './devtools'
import { applyForceOffline, cleanupForceOffline } from './forceOffline'

let runtimeSyncCleanup: (() => void) | undefined
let debugCleanup: (() => void) | undefined
let initialized = false

/** 初始化 DEV mock 框架；调用方通过 definitions 注入自己的 endpoint 和场景。 */
export async function initMock(options: InitMockOptions = {}): Promise<MockInitResult> {
  if (!import.meta.env.DEV) return { state: 'disabled' }

  if (options.definitions) setBrowserMockDefinitions(options.definitions)
  if (options.config) setMockConfig(options.config)

  initialized = true
  installRuntimeSync()
  debugCleanup ??= installMockDevtools()
  applyForceOffline(getMockConfig().forceOffline)

  await syncMockWorker()
  return getMockRuntimeStatus()
}

/** 替换调用方注入的定义，并让当前 worker 按最新配置重新同步。 */
export function setMockDefinitions(definitions: readonly MockEndpointDefinition[]): void {
  setBrowserMockDefinitions(definitions)
  if (initialized) void syncMockWorker().catch(() => undefined)
}

/** HMR 或测试清理入口；会恢复在线状态并让异步操作失去写入资格。 */
export function disposeMock(): void {
  runtimeSyncCleanup?.()
  runtimeSyncCleanup = undefined
  debugCleanup?.()
  debugCleanup = undefined
  initialized = false
  cleanupForceOffline()
  void stopMockWorker().catch(() => undefined)
}

function installRuntimeSync(): void {
  if (runtimeSyncCleanup) return

  const unsubscribe = subscribeMockConfig((config) => {
    applyForceOffline(config.forceOffline)
    void syncMockWorker().catch(() => undefined)
  })
  runtimeSyncCleanup = unsubscribe
}

if (import.meta.hot) import.meta.hot.dispose(disposeMock)

export * from './browser'
export type { MockEndpointDefinition, MockScenarioDefinition } from './browser'
export * from './config'
export type { MockConfig } from './config'
export * from './forceOffline'
export { MockDebugPanel } from './MockDebugPanel'
export type { MockDebugPanelProps } from './MockDebugPanel'

/** 可选启动配置；不传时使用空定义与已保存的配置。 */
export type InitMockOptions = {
  definitions?: readonly MockEndpointDefinition[]
  config?: Partial<MockConfig>
}

/** 开发环境返回实际 worker 状态，正式环境固定禁用。 */
export type MockInitResult =
  | { state: 'disabled' }
  | ReturnType<typeof getMockRuntimeStatus>

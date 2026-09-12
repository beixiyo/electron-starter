import { MOCK_CONFIG_STORAGE_KEY, readStoredMockConfig, writeStoredMockConfig } from './storage'

export { MOCK_CONFIG_STORAGE_KEY } from './storage'

/** handler 可读取的响应与分段延迟预设，单位为毫秒。 */
export const MOCK_DELAY_PRESETS = {
  fast: { response: 20, sequence: 24 },
  normal: { response: 100, sequence: 200 },
  slow: { response: 700, sequence: 600 },
} as const satisfies Record<MockDelayPreset, MockDelayConfig>

/** 默认直连真实请求，不模拟离线。 */
export const DEFAULT_MOCK_CONFIG: MockConfig = {
  endpointScenarios: {},
  delayPreset: 'normal',
  forceOffline: false,
}

let mockConfig = loadMockConfig()
let mockConfigSnapshot = cloneMockConfig(mockConfig)
const listeners = new Set<(config: MockConfig) => void>()

/** 供外部订阅的当前配置快照。 */
export function getMockConfig(): MockConfig {
  return mockConfigSnapshot
}

/** 合并配置、持久化并通知当前窗口；存储失败保留内存配置。 */
export function setMockConfig(patch: Partial<MockConfig>): void {
  mockConfig = normalizeMockConfig({
    ...mockConfig,
    ...patch,
    endpointScenarios: {
      ...mockConfig.endpointScenarios,
      ...patch.endpointScenarios,
    },
  })
  mockConfigSnapshot = cloneMockConfig(mockConfig)
  writeStoredMockConfig(mockConfig)
  emitMockConfigChange()
}

/** 切换指定 endpoint 的场景，空值视为关闭。 */
export function setMockEndpointScenario(endpointId: string, scenarioId: string): void {
  if (!endpointId) return
  setMockConfig({
    endpointScenarios: {
      [endpointId]: scenarioId || 'off',
    },
  })
}

/** 恢复全部默认配置并同步持久化。 */
export function resetMockConfig(): void {
  mockConfig = cloneMockConfig(DEFAULT_MOCK_CONFIG)
  mockConfigSnapshot = cloneMockConfig(mockConfig)
  writeStoredMockConfig(mockConfig)
  emitMockConfigChange()
}

/** 订阅配置变化，返回取消订阅函数。 */
export function subscribeMockConfig(listener: (config: MockConfig) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 读取当前预设延迟，供调用方在 handler 内决定等待时机。 */
export function getMockDelay(type: MockDelayKind): number {
  return MOCK_DELAY_PRESETS[mockConfig.delayPreset][type]
}

/** 判断配置中是否选择了非关闭场景。 */
export function hasEnabledMockEndpoints(config: MockConfig = mockConfig): boolean {
  return Object.values(config.endpointScenarios).some((scenario) => scenario !== 'off')
}

function loadMockConfig(): MockConfig {
  return normalizeMockConfig(readStoredMockConfig())
}

function normalizeMockConfig(value: unknown): MockConfig {
  const input = value && typeof value === 'object'
    ? value as Partial<MockConfig>
    : {}
  const endpointScenarios: Record<string, string> = {}

  if (input.endpointScenarios && typeof input.endpointScenarios === 'object') {
    for (const [endpointId, scenarioId] of Object.entries(input.endpointScenarios)) {
      if (typeof scenarioId === 'string' && scenarioId) endpointScenarios[endpointId] = scenarioId
    }
  }

  return {
    endpointScenarios,
    delayPreset: input.delayPreset === 'fast' || input.delayPreset === 'slow'
      ? input.delayPreset
      : 'normal',
    forceOffline: input.forceOffline === true,
  }
}

function cloneMockConfig(config: MockConfig): MockConfig {
  return {
    ...config,
    endpointScenarios: { ...config.endpointScenarios },
  }
}

function emitMockConfigChange(): void {
  const snapshot = getMockConfig()
  listeners.forEach((listener) => listener(snapshot))
}

function installMockConfigStorageSync(): void {
  if (typeof window === 'undefined') return

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== MOCK_CONFIG_STORAGE_KEY) return
    mockConfig = normalizeMockConfig(
      event.key === null
        ? readStoredMockConfig()
        : event.newValue === null
        ? null
        : parseStoredValue(event.newValue),
    )
    mockConfigSnapshot = cloneMockConfig(mockConfig)
    emitMockConfigChange()
  }

  window.addEventListener('storage', handleStorage)
  import.meta.hot?.dispose(() => window.removeEventListener('storage', handleStorage))
}

function parseStoredValue(value: string): unknown {
  try {
    return JSON.parse(value)
  }
  catch {
    return null
  }
}

installMockConfigStorageSync()

/** 持久化模拟配置，endpoint 名称由宿主声明。 */
export type MockConfig = {
  /** endpoint id 到 scenario id 的选择；`off` 表示直连真实请求。 */
  endpointScenarios: Record<string, string>
  delayPreset: MockDelayPreset
  forceOffline: boolean
}

/** 内置延迟档位。 */
export type MockDelayPreset = 'fast' | 'normal' | 'slow'
/** 响应开始或分段发送的延迟用途。 */
export type MockDelayKind = keyof MockDelayConfig

type MockDelayConfig = {
  response: number
  sequence: number
}

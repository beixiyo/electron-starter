/** 运行环境覆盖与跨窗口同步；请求和授权每次使用时读取，既有连接由其所有者重建。 */
import { isElectron } from '@/utils/env'
import { ENABLE_RUNTIME_TOOLS } from '@/featureFlags'
import type { RuntimeEnvEndpoints, RuntimeEnvPresetId } from './constants'
import { RUNTIME_ENV_ENDPOINT_KEYS, RUNTIME_ENV_PRESETS, RUNTIME_ENV_STORAGE_KEY } from './constants'

const listeners = new Set<() => void>()
let override = loadOverride()

/** 每次读取构建配置，避免共享模块首次求值时冻结当前环境。 */
export function getBuiltinRuntimeEnv(): RuntimeEnvEndpoints {
  const electron = isElectron()
  return {
    apiBaseUrl: (electron
      ? import.meta.env.VITE_ELECTRON_API_BASE_URL
      : import.meta.env.VITE_WEB_API_BASE_URL) ?? '',
    wsBaseUrl: (electron
      ? import.meta.env.VITE_ELECTRON_WS_BASE_URL
      : import.meta.env.VITE_WEB_WS_BASE_URL) ?? '',
    appleRedirectUri: (electron
      ? import.meta.env.VITE_ELECTRON_APPLE_REDIRECT_URI
      : import.meta.env.VITE_WEB_APPLE_REDIRECT_URI) ?? '',
    googleRedirectUri: (electron
      ? import.meta.env.VITE_ELECTRON_GOOGLE_REDIRECT_URI
      : import.meta.env.VITE_WEB_GOOGLE_REDIRECT_URI) ?? '',
  }
}

/** 解析预设或手填覆盖；空字段回落构建配置，面板可用此函数预览。 */
export function resolveRuntimeEnvEndpoints(value: RuntimeEnvOverride): RuntimeEnvEndpoints {
  const result = getBuiltinRuntimeEnv()
  const custom: Readonly<Partial<RuntimeEnvEndpoints>> = value.presetId === 'custom'
    ? value.custom
    : value.presetId === 'builtin'
    ? {}
    : RUNTIME_ENV_PRESETS[value.presetId]
  for (const key of RUNTIME_ENV_ENDPOINT_KEYS) {
    const value = custom[key]?.trim()
    if (value)
      result[key] = value
  }
  return result
}

/** 取得本次请求或新连接应使用的完整端点。 */
export function getRuntimeEnv(): RuntimeEnvEndpoints {
  return resolveRuntimeEnvEndpoints(override)
}

/** 稳定的只读快照，供 useSyncExternalStore 订阅；只在配置变更时替换引用。 */
export function getRuntimeEnvOverride(): RuntimeEnvOverride {
  return override
}

/** 持久化运行环境并通知本窗口；其他窗口通过 storage 事件接收。 */
export function setRuntimeEnvOverride(value: RuntimeEnvOverride): void {
  if (!ENABLE_RUNTIME_TOOLS)
    throw new Error('Runtime environment tools are disabled')
  const next = normalizeOverride(value)
  if (next.presetId === 'builtin')
    localStorage.removeItem(RUNTIME_ENV_STORAGE_KEY)
  else
    localStorage.setItem(RUNTIME_ENV_STORAGE_KEY, JSON.stringify(next))
  override = next
  listeners.forEach(listener => listener())
}

/** 恢复当前构建的默认端点。 */
export function resetRuntimeEnvOverride(): void {
  setRuntimeEnvOverride({ presetId: 'builtin', custom: {} })
}

/** 订阅配置变化；返回幂等清理函数。 */
export function subscribeRuntimeEnv(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function normalizeOverride(value: unknown): RuntimeEnvOverride {
  const input = value && typeof value === 'object'
      ? value as Partial<RuntimeEnvOverride>
      : {}
  const presetId: RuntimeEnvPresetId = typeof input.presetId === 'string'
    && (input.presetId === 'custom' || Object.hasOwn(RUNTIME_ENV_PRESETS, input.presetId))
    ? input.presetId as RuntimeEnvPresetId : 'builtin'
  const custom: Partial<RuntimeEnvEndpoints> = {}
  for (const key of RUNTIME_ENV_ENDPOINT_KEYS) {
    const raw = input.custom?.[key]
    if (typeof raw === 'string' && raw.trim())
      custom[key] = raw.trim()
  }
  return Object.freeze({ presetId, custom: Object.freeze(custom) })
}

function loadOverride(): RuntimeEnvOverride {
  if (!ENABLE_RUNTIME_TOOLS)
    return normalizeOverride(null)
  try {
    return normalizeOverride(JSON.parse(localStorage.getItem(RUNTIME_ENV_STORAGE_KEY) ?? 'null'))
  }
  catch {
    return normalizeOverride(null)
  }
}

if (typeof window !== 'undefined') {
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== null && event.storageArea !== localStorage)
      return
    if (event.key !== null && event.key !== RUNTIME_ENV_STORAGE_KEY)
      return
    override = loadOverride()
    listeners.forEach(listener => listener())
  }
  window.addEventListener('storage', onStorage)
  import.meta.hot?.dispose(() => window.removeEventListener('storage', onStorage))
}

/** 运行环境覆盖配置；custom 仅在手填模式使用。 */
export interface RuntimeEnvOverride {
  readonly presetId: RuntimeEnvPresetId
  readonly custom: Readonly<Partial<RuntimeEnvEndpoints>>
}

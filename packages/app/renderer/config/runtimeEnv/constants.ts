/** 模板的运行环境端点和预设；项目可在此添加自己的地址组。 */
export const RUNTIME_ENV_ENDPOINT_KEYS = ['apiBaseUrl', 'wsBaseUrl', 'appleRedirectUri', 'googleRedirectUri'] as const
export const RUNTIME_ENV_STORAGE_KEY = 'app:runtime-environment'

/** 预设只覆盖声明的端点，其余字段沿用当前构建配置。 */
export const RUNTIME_ENV_PRESETS = {
  local: {
    apiBaseUrl: 'http://localhost:3000',
    wsBaseUrl: 'ws://localhost:3000',
  },
} as const satisfies Record<string, Partial<RuntimeEnvEndpoints>>

/** 运行时可覆盖的端点键。 */
export type RuntimeEnvEndpointKey = typeof RUNTIME_ENV_ENDPOINT_KEYS[number]
/** 模板声明的地址组。 */
export type RuntimeEnvEndpoints = Record<RuntimeEnvEndpointKey, string>
/** 内置模式或在预设表声明的名称。 */
export type RuntimeEnvPresetId = 'builtin' | 'custom' | keyof typeof RUNTIME_ENV_PRESETS

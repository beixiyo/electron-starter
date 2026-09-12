/** Mock 配置的持久化边界；配置与应用账号数据分开保存。 */
export const MOCK_CONFIG_STORAGE_KEY = 'app:mock-debug-config'

/** 读取独立的模拟配置，存储不可用或格式无效时返回 null。 */
export function readStoredMockConfig(): unknown {
  if (typeof localStorage === 'undefined') return null

  try {
    const value = localStorage.getItem(MOCK_CONFIG_STORAGE_KEY)
    return value === null
      ? null
      : JSON.parse(value)
  }
  catch {
    return null
  }
}

/** 持久化模拟配置，失败只记录警告，不影响应用运行。 */
export function writeStoredMockConfig(value: unknown): void {
  if (typeof localStorage === 'undefined') return

  try {
    localStorage.setItem(MOCK_CONFIG_STORAGE_KEY, JSON.stringify(value))
  }
  catch (error) {
    console.warn('[mock] failed to persist configuration', error)
  }
}

/** 渲染层取得的远端开关快照；主进程消费者按自己的策略读取，不预置功能或后端键。 */
import type { FeatureFlagSnapshot } from '@ipc/services/feature-flag/contract'

const flags = new Map<string, boolean>()

/** 合并当前收到的开关，缺失键不改变原值。 */
export function setFeatureFlags(next: FeatureFlagSnapshot): void {
  for (const [key, enabled] of Object.entries(next)) flags.set(key, enabled)
}

/** 查询指定开关，未同步的键默认关闭。 */
export function isFeatureFlagEnabled(key: string): boolean {
  return flags.get(key) === true
}

/** 返回可序列化副本，调用方不能直接修改主进程状态。 */
export function getFeatureFlagSnapshot(): FeatureFlagSnapshot {
  return Object.fromEntries(flags)
}

import type { StorageAreaId } from '@shared/storage'
import { assertStorageAreaOwner } from '@shared/storage'
import localforage from 'localforage'

const registry = new Set<string>()
const areaRegistry = new Map<StorageAreaId, string>()

/**
 * 统一创建 localforage 实例，并防止同一存储区被重复声明
 *
 * @param config 必须包含唯一的 name、storeName 和已登记 storageAreaId
 */
export function createStore(
  config: LocalForageOptions & { name: string, storeName: string, storageAreaId: StorageAreaId },
): LocalForage {
  const key = `${config.name}/${config.storeName}`
  if (registry.has(key)) {
    throw new Error(`[storage] 重复创建 localforage 实例「${key}」，请复用 services/storage 中已声明的实例`)
  }
  registry.add(key)

  assertStorageAreaOwner(config.storageAreaId, 'renderer')

  const prevKey = areaRegistry.get(config.storageAreaId)
  if (prevKey && prevKey !== key) {
    throw new Error(`[storage] storageAreaId「${config.storageAreaId}」已绑定到「${prevKey}」，不能重复绑定到「${key}」`)
  }
  areaRegistry.set(config.storageAreaId, key)

  const { storageAreaId: _storageAreaId, ...localforageConfig } = config
  return localforage.createInstance(localforageConfig)
}

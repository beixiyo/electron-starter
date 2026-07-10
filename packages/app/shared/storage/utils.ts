import type { StorageAreaId } from './constants'
import type { StorageAreaEntry, StorageOwner } from './types'
import { STORAGE_AREAS } from './constants'

const STORAGE_AREA_BY_ID = new Map<string, StorageAreaEntry>(
  STORAGE_AREAS.map(area => [area.id, area]),
)

/**
 * 读取已登记的存储区，运行时也会校验传入 id
 */
export function getStorageAreaEntry(id: StorageAreaId): StorageAreaEntry {
  const area = STORAGE_AREA_BY_ID.get(id)
  if (!area)
    throw new Error(`[storage] 未登记的存储区：${id}`)

  return area
}

/**
 * 读取指定 owner 的存储区，防止入口跨层误用
 */
export function assertStorageAreaOwner<Owner extends StorageOwner>(
  id: StorageAreaId,
  owner: Owner,
): StorageAreaEntry & { owner: Owner } {
  const area = getStorageAreaEntry(id)
  if (area.owner !== owner) {
    throw new Error(`[storage] 存储区「${id}」归属为「${area.owner}」，不能在「${owner}」入口使用`)
  }

  return area as StorageAreaEntry & { owner: Owner }
}

/**
 * 持久化存储区的运行时 owner
 *
 * @default 'shared'
 */
export type StorageOwner = 'main' | 'renderer' | 'shared'

/**
 * Electron 端存储区元信息
 *
 * @default ttl 'none'
 */
export interface StorageAreaEntry {
  /** 用于查询和诊断的稳定 id */
  id: string
  /** 负责写入和清理的进程或层 */
  owner: StorageOwner
  /** 物理根目录或 Electron 路径来源 */
  root: string
  /** 可由代码直接解析的基础路径 */
  basePath: string
  /** 根目录下的相对路径 */
  path: string
  /** 人类可读的数据内容说明 */
  content: string
  /** 拥有或使用该存储区的代码入口 */
  entrypoints: readonly string[]
  /** 是否按 ownerId 或账号 key 隔离 */
  accountScoped: boolean
  /** 应用登出时是否应该清理 */
  logoutCleanup: boolean
  /** 是否可能包含用户隐私数据 */
  sensitive: boolean
  /** 是否可从服务端或本地状态重建 */
  rebuildable: boolean
  /** 保留规则或清理触发点 */
  ttl: string
}

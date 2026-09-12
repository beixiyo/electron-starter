import type { IpcContract } from '@ipc/core'

/** 主进程权威客户端环境快照 IPC 契约。 */
export type ClientEnvContract = IpcContract<{
  mainHandle: {
    /** 获取归一化后的客户端平台。 */
    getPlatform: () => ClientEnvPlatform
    /** 获取当前 Electron 客户端环境。 */
    getSnapshot: () => ClientEnvSnapshot
  }
}>

/** 客户端运行平台。 */
export type ClientEnvPlatform
  = | 'mac'
    | 'windows'
    | 'linux'
    | 'unknown'

/** 主进程采集的客户端环境快照。 */
export interface ClientEnvSnapshot {
  /** 归一化后的平台。 */
  platform: ClientEnvPlatform
  /** Node 原始平台值。 */
  rawPlatform: NodeJS.Platform
  /** CPU 架构。 */
  arch: string
  /** 系统名称和版本。 */
  osVersion: string
  /** 设备型号；无法读取时为空字符串或平台回退值。 */
  deviceModel: string
  /** App 版本。 */
  appVersion: string
  /** 总内存，单位 byte。 */
  totalMemoryBytes?: number
  /** 可用内存，单位 byte。 */
  availableMemoryBytes?: number
  /** 总磁盘空间，单位 byte。 */
  totalDiskSpaceBytes?: number
  /** 可用磁盘空间，单位 byte。 */
  availableDiskSpaceBytes?: number
}

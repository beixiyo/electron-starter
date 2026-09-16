/** 自动更新服务的内部配置与元数据类型。 */
/** {@link initAutoUpdater} 配置项 */
export interface InitAutoUpdaterOptions {
  /**
   * 发现新版本后是否自动开始下载
   * @default false
   */
  autoDownload?: boolean
  /**
   * 已下载的更新是否在应用退出时自动安装
   * @default true
   */
  autoInstallOnAppQuit?: boolean
  /**
   * 是否在初始化后立即检查一次更新
   * @default false
   */
  checkOnStart?: boolean
  /**
   * 是否禁用增量（blockmap）下载，强制每次全量
   * 仅当更新服务器不支持 HTTP Range 时才需要
   * @default false
   */
  disableDifferentialDownload?: boolean
  /**
   * 启动后延迟多少毫秒做首次检查（避开启动高峰）；设 0 关闭
   * @default 10000
   */
  initialCheckDelayMs?: number
  /**
   * 周期轮询检查的间隔毫秒数；设 0 关闭周期轮询
   * @default 14400000 （4 小时）
   */
  pollIntervalMs?: number
}

export type ProgressSnapshot = {
  transferred: number
  timestamp: number
}

export type PendingDownloadTarget = {
  fileName: string
  total: number
}

export type UpdateInfoWithFiles = {
  files?: Array<{
    size?: number
    url?: string
  }>
  path?: string
  size?: number
}

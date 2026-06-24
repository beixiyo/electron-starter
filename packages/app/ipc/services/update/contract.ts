import type { IpcContract } from '@ipc/core'

/**
 * 更新状态机（驱动渲染端 UI）
 *
 * - `checking` 正在向服务器查询新版本
 * - `available` 发现新版本（等待下载，autoDownload=false 时需手动触发）
 * - `not-available` 已是最新
 * - `downloading` 下载中（配合 `progress` 事件展示进度）
 * - `downloaded` 下载完成，可调用 `install()` 重启安装
 * - `error` 出错（见 `error` 字段）
 */
export type UpdateStatus
  = | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'

/**
 * 裁剪后的版本信息（仅保留可序列化、渲染端会用到的字段）
 *
 * 不直接透传 electron-updater 的 `UpdateInfo`：它含 `files`/`sha512` 等渲染端无用字段，
 * 且 `releaseNotes` 可能是对象数组，跨 IPC 传递需先归一化为字符串
 */
export interface UpdateInfoLite {
  /** 新版本号，如 `1.2.0` */
  version: string
  /** 发布时间（ISO 字符串），来自更新元数据 */
  releaseDate?: string
  /** 更新说明，仅当元数据里是纯字符串时透传 */
  releaseNotes?: string
}

/**
 * `check()` 的同步返回值
 *
 * 注意：`available` 的权威来源仍是 `status` 事件，本返回值供 Promise 形式的调用方就近取用
 */
export interface UpdateCheckOutcome {
  /** 是否有可用新版本 */
  available: boolean
  /** 有新版本时的版本信息 */
  info?: UpdateInfoLite
}

/** `status` 事件载荷 */
export interface UpdateStatusEvent {
  status: UpdateStatus
  /** `status` 为 `available` / `downloaded` 时携带 */
  info?: UpdateInfoLite
  /** `status` 为 `error` 时的错误信息 */
  error?: string
}

/** `progress` 事件载荷（下载进度，字段取自 electron-updater 的 `ProgressInfo`） */
export interface UpdateProgress {
  /** 已完成百分比，0 ~ 100 */
  percent: number
  /** 已传输字节数 */
  transferred: number
  /** 总字节数 */
  total: number
  /** 实时下载速率（字节/秒） */
  bytesPerSecond: number
}

/**
 * 应用更新 IPC 契约
 *
 * - invoke：渲染进程发起检查 / 下载 / 安装，并查询当前版本
 * - events：主进程把更新状态与下载进度推回渲染进程
 */
export type UpdateContract = IpcContract<{
  /** 主动检查更新；过程同时通过 `status` 事件广播 */
  check: () => UpdateCheckOutcome
  /** 开始下载更新（autoDownload=false 时由 UI 确认后调用） */
  download: () => void
  /** 退出并安装已下载好的更新（会先关闭所有窗口） */
  install: () => void
  /** 当前应用版本号 */
  getVersion: () => string
}, {
  status: UpdateStatusEvent
  progress: UpdateProgress
}>

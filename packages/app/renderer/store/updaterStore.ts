import type { UpdateCheckOutcome, UpdateInfoLite, UpdateProgress, UpdateStatus } from '@ipc/services/update/contract'
import { useSyncExternalStore } from 'react'
import { isElectron } from '@/utils/env'

/**
 * 应用更新全局状态（单一数据源，基于 useSyncExternalStore）
 *
 * 主进程通过 `status` / `progress` 事件推送权威状态，这里订阅一次并写入模块级状态，
 * 设置入口与全局更新弹窗共享同一份：后台轮询发现新版本时自动弹窗，手动检查也会同步反映。
 *
 * Web 环境下 {@link updaterAvailable} 为 false，不订阅、动作空转，调用方据此隐藏入口。
 */

/** 内部状态机：契约状态额外加一个初始 `idle` */
export type UpdaterStatus = UpdateStatus | 'idle'

export interface UpdaterState {
  /** 当前应用版本号 */
  currentVersion: string
  /** 更新状态机 */
  status: UpdaterStatus
  /** 可用 / 已下载更新的版本信息 */
  info: UpdateInfoLite | null
  /** 下载进度（仅下载阶段非空） */
  progress: UpdateProgress | null
  /** 错误信息（status 为 error 时） */
  error: string | null
  /** 更新弹窗是否打开 */
  modalOpen: boolean
}

/** 当前环境是否支持更新（仅 Electron 桌面端） */
export const updaterAvailable = isElectron()

let state: UpdaterState = {
  currentVersion: '',
  status: 'idle',
  info: null,
  progress: null,
  error: null,
  modalOpen: false,
}

const listeners = new Set<() => void>()

/** 已被「稍后」关闭过的版本号；同一版本后续轮询不再重复弹窗，出现更高版本才再弹 */
let dismissedVersion = ''

/** 整体替换引用并通知订阅者（useSyncExternalStore 依赖引用变化） */
function setState(patch: Partial<UpdaterState>): void {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getSnapshot(): UpdaterState {
  return state
}

/** 组件订阅全局更新状态 */
export function useUpdaterState(): UpdaterState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

let initialized = false

/** 订阅主进程更新事件（幂等，App 挂载时调用一次即可） */
export function initUpdaterStore(): void {
  if (initialized || !updaterAvailable)
    return
  initialized = true

  void $ipc.update.getVersion().then((v) => {
    setState({ currentVersion: v })
  })

  $ipc.update.on('status', (payload) => {
    const patch: Partial<UpdaterState> = {
      status: payload.status,
      error: payload.status === 'error'
        ? payload.error ?? 'unknown error'
        : null,
    }

    if (payload.info)
      patch.info = payload.info

    /** 离开下载流程时清空进度，避免下次检查仍残留旧进度条 */
    if (payload.status !== 'downloading' && payload.status !== 'downloaded')
      patch.progress = null

    setState(patch)

    /** 发现新版本（且不是已被「稍后」忽略过的同一版本）→ 自动弹窗 */
    if (
      payload.status === 'available'
      && payload.info
      && payload.info.version !== dismissedVersion
    ) {
      setState({ modalOpen: true })
    }
  })

  $ipc.update.on('progress', (payload) => {
    /** 进度到来即视为下载中（download-progress 之前没有独立的开始事件） */
    setState({ progress: payload, status: 'downloading' })
  })
}

/** 检查更新；结果同时通过 status 事件驱动 UI（含自动弹窗） */
export async function checkUpdate(): Promise<UpdateCheckOutcome | undefined> {
  if (!updaterAvailable)
    return

  setState({ error: null, status: 'checking' })
  try {
    return await $ipc.update.check()
  }
  catch {
    /** 网络等错误会通过 error 事件回传并更新 status，这里无需重复处理 */
    return undefined
  }
}

/** 开始下载更新 */
export function downloadUpdate(): void {
  if (!updaterAvailable)
    return

  setState({ error: null, progress: null, status: 'downloading' })
  void $ipc.update.download().catch(() => {
    setState({ status: 'error', error: 'update failed' })
  })
}

/** 退出并安装已下载好的更新 */
export function installUpdate(): void {
  if (!updaterAvailable)
    return

  void $ipc.update.install().catch(() => {
    setState({ status: 'error', error: 'update failed' })
  })
}

/** 打开弹窗（设置入口手动触发，同时补一次检查让用户看到最新结果） */
export function openUpdaterModal(): void {
  setState({ modalOpen: true })
  if (state.status === 'idle' || state.status === 'not-available' || state.status === 'error')
    void checkUpdate()
}

/** 关闭弹窗；若当前是「待下载」态则记下该版本，避免同版本反复打扰 */
export function closeUpdaterModal(): void {
  if (state.status === 'available' && state.info)
    dismissedVersion = state.info.version
  setState({ modalOpen: false })
}

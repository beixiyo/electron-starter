import type { UpdateCheckOutcome, UpdateInfoLite, UpdateProgress, UpdateStatus } from '@ipc/services/update/contract'
import { useLatestCallback } from 'hooks'
import { useEffect, useState } from 'react'
import { isElectron } from '@/utils/env'

/**
 * 应用自动更新（仅 Electron 可用）
 *
 * 订阅主进程推送的 `status` / `progress` 事件维护本地状态，并暴露
 * `check` / `download` / `install` 三个动作。Web 环境下 `available` 为 false，
 * 动作空转、不订阅，调用方据此隐藏更新入口。
 *
 * 状态权威来源是主进程事件；`check()` / `download()` 仅做乐观状态切换让 UI 更跟手。
 *
 * @example
 * ```tsx
 * const { available, status, info, progress, check, download, install } = useUpdater()
 * if (!available) return null
 * ```
 */
export function useUpdater() {
  const available = isElectron()

  const [currentVersion, setCurrentVersion] = useState('')
  const [status, setStatus] = useState<UpdaterStatus>('idle')
  const [info, setInfo] = useState<UpdateInfoLite | null>(null)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!available)
      return

    $ipc.update.getVersion().then(setCurrentVersion)

    const offStatus = $ipc.update.on('status', (payload) => {
      setStatus(payload.status)

      if (payload.info)
        setInfo(payload.info)

      setError(payload.status === 'error'
        ? payload.error ?? 'unknown error'
        : null)

      /** 离开下载流程时清空进度，避免下次检查仍残留旧进度条 */
      if (payload.status !== 'downloading' && payload.status !== 'downloaded')
        setProgress(null)
    })

    const offProgress = $ipc.update.on('progress', (payload) => {
      setProgress(payload)
      /** 进度到来即视为下载中（download-progress 之前没有独立的开始事件） */
      setStatus('downloading')
    })

    return () => {
      offStatus()
      offProgress()
    }
  }, [available])

  /** 检查更新；返回结果同时也会通过 status 事件驱动 UI */
  const check = useLatestCallback(async (): Promise<UpdateCheckOutcome | undefined> => {
    if (!available)
      return

    setError(null)
    setStatus('checking')
    try {
      return await $ipc.update.check()
    }
    catch {
      /** 网络等错误也会通过 error 事件回传并更新 status，这里无需重复处理 */
      return undefined
    }
  })

  /** 开始下载更新 */
  const download = useLatestCallback(() => {
    if (!available)
      return

    setError(null)
    setProgress(null)
    setStatus('downloading')
    void $ipc.update.download().catch(() => {
      setStatus('error')
      setError('update failed')
    })
  })

  /** 退出并安装已下载好的更新 */
  const install = useLatestCallback(() => {
    if (!available)
      return

    void $ipc.update.install().catch(() => {
      setStatus('error')
      setError('update failed')
    })
  })

  return {
    /** 当前环境是否支持更新（仅 Electron） */
    available,
    /** 当前应用版本号 */
    currentVersion,
    /** 更新状态机 */
    status,
    /** 可用 / 已下载更新的版本信息 */
    info,
    /** 下载进度（仅下载阶段非空） */
    progress,
    /** 错误信息（status 为 error 时） */
    error,
    check,
    download,
    install,
  }
}

/** hook 内部状态：契约状态机额外加一个初始 `idle` */
type UpdaterStatus = UpdateStatus | 'idle'

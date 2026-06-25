import {
  checkUpdate,
  downloadUpdate,
  installUpdate,
  openUpdaterModal,
  updaterAvailable,
  useUpdaterState,
} from '@/store/updaterStore'

/**
 * 应用自动更新（仅 Electron 可用）
 *
 * 读取 {@link updaterStore} 的全局状态并暴露 `check` / `download` / `install` 动作。
 * 状态由主进程事件驱动、全局共享（设置入口与更新弹窗同源）。Web 环境下 `available`
 * 为 false，动作空转，调用方据此隐藏更新入口。
 *
 * @example
 * ```tsx
 * const { available, status, info, progress, check, download, install } = useUpdater()
 * if (!available) return null
 * ```
 */
export function useUpdater() {
  const { currentVersion, status, info, progress, error } = useUpdaterState()

  return {
    /** 当前环境是否支持更新（仅 Electron） */
    available: updaterAvailable,
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
    check: checkUpdate,
    download: downloadUpdate,
    install: installUpdate,
    /** 打开全局更新弹窗 */
    openModal: openUpdaterModal,
  }
}

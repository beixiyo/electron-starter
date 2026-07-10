const shortcutRuntimeSyncListeners = new Set<() => void>()

/** 订阅快捷键 runtime 重新同步请求 */
export function onShortcutRuntimeSyncRequested(listener: () => void): () => void {
  shortcutRuntimeSyncListeners.add(listener)

  return () => {
    shortcutRuntimeSyncListeners.delete(listener)
  }
}

/** 请求主进程按当前权限、平台和持久化配置重新注册快捷键 */
export function requestShortcutRuntimeSync(): void {
  for (const listener of shortcutRuntimeSyncListeners)
    listener()
}

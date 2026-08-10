const shortcutRuntimeSyncListeners = new Set<() => void>()
let isSyncing = false
let syncPending = false
let syncFlushQueued = false

/** 订阅快捷键运行时重新同步请求 */
export function onShortcutRuntimeSyncRequested(listener: () => void): () => void {
  shortcutRuntimeSyncListeners.add(listener)

  return () => {
    shortcutRuntimeSyncListeners.delete(listener)
  }
}

/** 请求主进程按当前权限、平台和持久化配置重新注册快捷键 */
export function requestShortcutRuntimeSync(): void {
  syncPending = true

  /**
   * 捕获后端在重新应用期间报告启动失败是合法时序：当前这一轮仍在重置和应用，
   * 不能从监听器内同步重入下一轮，否则会递归重置并重复注册原生监听器。
   * 先标记为待处理，当前轮结束后由微任务合并执行。
   */
  if (isSyncing || syncFlushQueued)
    return

  flushShortcutRuntimeSync()
}

function flushShortcutRuntimeSync(): void {
  if (isSyncing)
    return

  isSyncing = true
  syncPending = false
  try {
    for (const listener of shortcutRuntimeSyncListeners)
      listener()
  }
  finally {
    isSyncing = false
    queuePendingSync()
  }
}

function queuePendingSync(): void {
  if (!syncPending || syncFlushQueued)
    return

  syncFlushQueued = true
  queueMicrotask(() => {
    syncFlushQueued = false
    flushShortcutRuntimeSync()
  })
}

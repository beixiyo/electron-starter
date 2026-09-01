/** 管理快捷键 runtime 的录制暂停状态及同步清理通知 */
let suspended = false
const suspensionListeners = new Set<() => void>()

/** 录制期间是否暂停所有快捷键 runtime */
export function isShortcutRuntimeSuspended(): boolean {
  return suspended
}

export function suspendShortcutRuntime(): void {
  if (suspended)
    return

  suspended = true
  for (const listener of suspensionListeners)
    listener()
}

export function resumeShortcutRuntime(): void {
  suspended = false
}

/** 订阅 runtime 从运行态进入暂停态的瞬间；返回幂等取消订阅函数 */
export function addShortcutRuntimeSuspensionListener(listener: () => void): () => void {
  suspensionListeners.add(listener)

  return () => {
    suspensionListeners.delete(listener)
  }
}

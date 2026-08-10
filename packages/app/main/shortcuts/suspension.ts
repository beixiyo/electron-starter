let suspended = false

/** 录制期间是否暂停所有快捷键 runtime */
export function isShortcutRuntimeSuspended(): boolean {
  return suspended
}

export function suspendShortcutRuntime(): void {
  suspended = true
}

export function resumeShortcutRuntime(): void {
  suspended = false
}

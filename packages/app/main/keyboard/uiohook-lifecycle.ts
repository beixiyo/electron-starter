import { uIOhook } from 'uiohook-napi'

let refCount = 0
let running = false

/** 声明需要 uIOhook，若尚未启动则启动 */
export function acquireHook(): void {
  refCount++
  if (running)
    return
  uIOhook.start()
  running = true
}

/** 释放对 uIOhook 的需求，所有使用方释放后自动停止 */
export function releaseHook(): void {
  if (refCount <= 0)
    return
  refCount--
  if (refCount > 0 || !running)
    return
  uIOhook.stop()
  running = false
}

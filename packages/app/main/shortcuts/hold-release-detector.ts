import type { UiohookKeyboardEvent } from 'uiohook-napi'
import { uIOhook } from 'uiohook-napi'
import { resolveKeyGroup } from './resolveKeyGroup'
import { acquireHook, releaseHook } from './uiohook-lifecycle'

const registeredAccelerators = new Map<string, RegisteredAccelerator>()
const activeAccelerators = new Map<string, ActiveAccelerator>()

let hookAcquired = false
let listenerBound = false

/**
 * 注册长按快捷键，预解析 accelerator
 */
export function registerHoldReleaseDetector(accelerator: string): void {
  if (registeredAccelerators.has(accelerator))
    return

  const entry: RegisteredAccelerator = {
    accelerator,
    keyGroups: parseAccelerator(accelerator),
  }

  registeredAccelerators.set(accelerator, entry)
  ensureHookRunning()
}

/**
 * 取消注册长按快捷键
 */
export function unregisterHoldReleaseDetector(accelerator: string): void {
  deactivateHoldReleaseDetector(accelerator)
  registeredAccelerators.delete(accelerator)
  maybeStopHook()
}

/**
 * 激活长按检测（在用户按下快捷键时调用）
 */
export function activateHoldReleaseDetector(
  accelerator: string,
  onRelease: () => void,
): void {
  const entry = registeredAccelerators.get(accelerator)
  if (!entry)
    throw new Error(`未注册的长按快捷键: ${accelerator}`)

  activeAccelerators.set(accelerator, { ...entry, onRelease })
}

/**
 * 取消激活状态（在松开或清理时调用）
 */
export function deactivateHoldReleaseDetector(accelerator: string): void {
  activeAccelerators.delete(accelerator)
}

/**
 * 清空所有已注册的长按检测（用于应用退出）
 */
export function clearHoldReleaseDetectors(): void {
  activeAccelerators.clear()
  registeredAccelerators.clear()
  maybeStopHook()
}

function handleKeyUp(event: UiohookKeyboardEvent): void {
  for (const [accelerator, entry] of activeAccelerators.entries()) {
    if (isKeyWithinAccelerator(event.keycode, entry.keyGroups)) {
      activeAccelerators.delete(accelerator)
      queueMicrotask(entry.onRelease)
    }
  }
}

function isKeyWithinAccelerator(keycode: number, groups: number[][]): boolean {
  return groups.some(group => group.includes(keycode))
}

function ensureHookRunning(): void {
  if (!listenerBound) {
    uIOhook.on('keyup', handleKeyUp)
    listenerBound = true
  }

  if (!hookAcquired) {
    acquireHook()
    hookAcquired = true
  }
}

function maybeStopHook(): void {
  if (registeredAccelerators.size > 0)
    return

  if (listenerBound) {
    uIOhook.off('keyup', handleKeyUp)
    listenerBound = false
  }

  if (hookAcquired) {
    releaseHook()
    hookAcquired = false
  }
}

function parseAccelerator(accelerator: string): number[][] {
  const tokens = accelerator.split('+').map(token => token.trim()).filter(Boolean)
  if (!tokens.length)
    throw new Error(`非法的快捷键: ${accelerator}`)

  return tokens.map(resolveKeyGroup)
}

type RegisteredAccelerator = {
  accelerator: string
  keyGroups: number[][]
}

type ActiveAccelerator = RegisteredAccelerator & {
  onRelease: () => void
}

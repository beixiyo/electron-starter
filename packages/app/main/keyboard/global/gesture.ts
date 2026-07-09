import type { KeyboardShortcutChord, ShortcutBinding, ShortcutGestureType, ShortcutModifier } from '@ipc/services/shortcut-config/contract'
import type { UiohookKeyboardEvent } from 'uiohook-napi'
import { DOUBLE_PRESS_INTERVAL_MS } from '@shared'
import { uIOhook } from 'uiohook-napi'
import { logError } from '../../utils/logger'
import { isSuspended } from '../fn'
import { resolveKeyGroup } from '../hold/resolve-key-group'
import { acquireHook, releaseHook } from '../uiohook-lifecycle'

const DEFAULT_HOLD_MIN_DURATION_MS = 300

const registeredShortcuts = new Map<string, RegisteredKeyboardGestureShortcut>()
const activeShortcutIds = new Set<string>()
const triggeredHoldIds = new Set<string>()
const holdTimers = new Map<string, ReturnType<typeof setTimeout>>()
const doublePressTimers = new Map<string, ReturnType<typeof setTimeout>>()
const lastPressTimes = new Map<string, number>()

let hookAcquired = false
let listenerBound = false

/**
 * 注册键盘手势快捷键。
 * 当前实现用 uIOhook 捕获真实 keydown/keyup，后续可在同一接口下替换为平台 native backend
 */
export function registerKeyboardGestureShortcut(config: KeyboardGestureShortcutConfig): boolean {
  const { id, binding } = config

  try {
    const shortcut: RegisteredKeyboardGestureShortcut = {
      ...config,
      match: createChordMatch(binding.chord),
    }
    registeredShortcuts.set(id, shortcut)
    ensureHookRunning()
    return true
  }
  catch (error) {
    logError('键盘手势快捷键注册失败', error, {
      module: 'shortcuts',
      operation: 'registerKeyboardGestureShortcut',
      context: { id, key: binding.chord.key, gesture: binding.gesture },
    })
    return false
  }
}

/**
 * 取消所有键盘手势快捷键，并清理按键状态
 */
export function unregisterKeyboardGestureShortcuts(): void {
  clearRuntimeState()
  registeredShortcuts.clear()
  maybeStopHook()
}

/**
 * 清理键盘手势快捷键状态。
 * 用于应用退出或重注册前释放 timer / uIOhook listener
 */
export function resetKeyboardGestureShortcutStates(): void {
  unregisterKeyboardGestureShortcuts()
}

function handleKeyDown(event: UiohookKeyboardEvent): void {
  if (isSuspended())
    return

  for (const shortcut of registeredShortcuts.values()) {
    if (!matchesShortcut(event, shortcut.match))
      continue
    if (activeShortcutIds.has(shortcut.id))
      continue

    activeShortcutIds.add(shortcut.id)
    handleShortcutDown(shortcut)
  }
}

function handleKeyUp(event: UiohookKeyboardEvent): void {
  for (const shortcut of registeredShortcuts.values()) {
    if (!isKeyWithinGroups(event.keycode, shortcut.match.mainKeyGroup))
      continue

    handleShortcutUp(shortcut)
  }
}

function handleShortcutDown(shortcut: RegisteredKeyboardGestureShortcut): void {
  switch (shortcut.binding.gesture) {
    case 'press':
      shortcut.onTrigger('press')
      return

    case 'doublePress':
      handleDoublePressShortcut(shortcut)
      return

    case 'hold':
      handleHoldShortcutDown(shortcut)
      return
  }
}

function handleShortcutUp(shortcut: RegisteredKeyboardGestureShortcut): void {
  activeShortcutIds.delete(shortcut.id)
  clearHoldTimer(shortcut.id)

  if (triggeredHoldIds.has(shortcut.id)) {
    triggeredHoldIds.delete(shortcut.id)
    shortcut.onRelease?.('hold')
  }
}

function handleDoublePressShortcut(shortcut: RegisteredKeyboardGestureShortcut): void {
  const { id, binding, onTrigger } = shortcut
  const intervalMs = binding.intervalMs ?? DOUBLE_PRESS_INTERVAL_MS
  const now = Date.now()
  const last = lastPressTimes.get(id) ?? 0
  const existingTimer = doublePressTimers.get(id)
  const isDoublePress = existingTimer !== undefined && now - last <= intervalMs

  if (isDoublePress) {
    clearTimeout(existingTimer)
    doublePressTimers.delete(id)
    lastPressTimes.delete(id)
    onTrigger('doublePress')
    return
  }

  if (existingTimer)
    clearTimeout(existingTimer)

  lastPressTimes.set(id, now)
  doublePressTimers.set(
    id,
    setTimeout(() => {
      doublePressTimers.delete(id)
      lastPressTimes.delete(id)
    }, intervalMs),
  )
}

function handleHoldShortcutDown(shortcut: RegisteredKeyboardGestureShortcut): void {
  const { id, binding, onTrigger } = shortcut
  const minDurationMs = binding.minDurationMs ?? DEFAULT_HOLD_MIN_DURATION_MS
  clearHoldTimer(id)

  holdTimers.set(
    id,
    setTimeout(() => {
      holdTimers.delete(id)
      if (!activeShortcutIds.has(id) || isSuspended())
        return

      triggeredHoldIds.add(id)
      onTrigger('hold')
    }, minDurationMs),
  )
}

function createChordMatch(chord: KeyboardShortcutChord): KeyboardChordMatch {
  return {
    mainKeyGroup: resolveKeyGroup(chord.key),
    requiredModifiers: createRequiredModifiers(chord.modifiers),
  }
}

function createRequiredModifiers(modifiers: ShortcutModifier[]): Set<ModifierState> {
  const required = new Set<ModifierState>()

  for (const modifier of modifiers) {
    switch (modifier) {
      case 'Primary':
        required.add(process.platform === 'darwin'
          ? 'meta'
          : 'control')
        break
      case 'Meta':
        required.add('meta')
        break
      case 'Control':
        required.add('control')
        break
      case 'Alt':
        required.add('alt')
        break
      case 'Shift':
        required.add('shift')
        break
    }
  }

  return required
}

function matchesShortcut(event: UiohookKeyboardEvent, match: KeyboardChordMatch): boolean {
  return isKeyWithinGroups(event.keycode, match.mainKeyGroup)
    && matchesModifiers(event, match.requiredModifiers)
}

function matchesModifiers(event: UiohookKeyboardEvent, requiredModifiers: Set<ModifierState>): boolean {
  return event.metaKey === requiredModifiers.has('meta')
    && event.ctrlKey === requiredModifiers.has('control')
    && event.altKey === requiredModifiers.has('alt')
    && event.shiftKey === requiredModifiers.has('shift')
}

function isKeyWithinGroups(keycode: number, group: number[]): boolean {
  return group.includes(keycode)
}

function clearRuntimeState(): void {
  holdTimers.forEach(clearTimeout)
  holdTimers.clear()
  doublePressTimers.forEach(clearTimeout)
  doublePressTimers.clear()
  lastPressTimes.clear()
  activeShortcutIds.clear()
  triggeredHoldIds.clear()
}

function clearHoldTimer(id: string): void {
  const timer = holdTimers.get(id)
  if (!timer)
    return

  clearTimeout(timer)
  holdTimers.delete(id)
}

function ensureHookRunning(): void {
  if (!listenerBound) {
    uIOhook.on('keydown', handleKeyDown)
    uIOhook.on('keyup', handleKeyUp)
    listenerBound = true
  }

  if (!hookAcquired) {
    acquireHook()
    hookAcquired = true
  }
}

function maybeStopHook(): void {
  if (registeredShortcuts.size > 0)
    return

  if (listenerBound) {
    uIOhook.off('keydown', handleKeyDown)
    uIOhook.off('keyup', handleKeyUp)
    listenerBound = false
  }

  if (hookAcquired) {
    releaseHook()
    hookAcquired = false
  }
}

export type KeyboardGestureShortcutConfig = {
  /** action id，用于隔离每个绑定的 runtime 状态 */
  id: string
  /** 已持久化的 keyboard binding */
  binding: ShortcutBinding & { chord: KeyboardShortcutChord }
  /** press / doublePress / hold 触发时调用 */
  onTrigger: (gesture: ShortcutGestureType) => void
  /** hold 释放时调用 */
  onRelease?: (gesture: Extract<ShortcutGestureType, 'hold'>) => void
}

type RegisteredKeyboardGestureShortcut = KeyboardGestureShortcutConfig & {
  match: KeyboardChordMatch
}

type KeyboardChordMatch = {
  mainKeyGroup: number[]
  requiredModifiers: Set<ModifierState>
}

type ModifierState = 'meta' | 'control' | 'alt' | 'shift'

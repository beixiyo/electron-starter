import type {
  KeyboardShortcutChord,
  ShortcutBinding,
  ShortcutGestureRuntimeEntry,
  ShortcutGestureType,
  ShortcutModifier,
  ShortcutRecordEvent,
  ShortcutRuntimeEvent,
} from '@shared/shortcuts'
import type { UiohookKeyboardEvent } from 'uiohook-napi'
import { createShortcutGestureEngine } from '@shared/shortcuts'
import { uIOhook } from 'uiohook-napi'
import { logError } from '../../utils/logger'
import { isSuspended } from '../fn'
import { resolveKeyGroup } from '../hold/resolve-key-group'
import { acquireHook, releaseHook } from '../uiohook-lifecycle'

/** action id → 已解析的 keyboard gesture 注册项 */
const registeredShortcuts = new Map<string, RegisteredKeyboardGestureShortcut>()

/** 当前 backend 是否已经占用 uIOhook lifecycle 引用计数 */
let hookAcquired = false

/** 当前 backend 是否已经绑定 keydown/keyup listener，避免重复监听 */
let listenerBound = false

const gestureEngine = createShortcutGestureEngine<KeyboardGestureBinding>({
  entries: [],
  isPaused,
  emit: emitKeyboardGestureEvent,
})

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
    syncGestureEngineEntries()
    ensureHookRunning()
    return true
  }
  catch (error) {
    registeredShortcuts.delete(id)
    syncGestureEngineEntries()
    maybeStopHook()
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
  registeredShortcuts.clear()
  syncGestureEngineEntries()
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
  if (isSuspended()) {
    gestureEngine.clear()
    return
  }

  const timestamp = Date.now()
  for (const shortcut of registeredShortcuts.values()) {
    if (!matchesShortcut(event, shortcut.match))
      continue

    gestureEngine.handle(toRecordEvent('down', shortcut.binding, timestamp))
  }
}

function handleKeyUp(event: UiohookKeyboardEvent): void {
  const timestamp = Date.now()
  for (const shortcut of registeredShortcuts.values()) {
    if (!isKeyWithinGroups(event.keycode, shortcut.match.mainKeyGroup))
      continue

    gestureEngine.handle(toRecordEvent('up', shortcut.binding, timestamp))
  }
}

function emitKeyboardGestureEvent(event: ShortcutRuntimeEvent & { binding: KeyboardGestureBinding }): void {
  const shortcut = registeredShortcuts.get(event.id)
  if (!shortcut)
    return

  if (event.phase === 'trigger') {
    shortcut.onTrigger(event.gesture)
    return
  }

  shortcut.onRelease?.('hold')
}

function toRecordEvent(
  phase: Extract<ShortcutRecordEvent['phase'], 'down' | 'up'>,
  binding: KeyboardGestureBinding,
  timestamp: number,
): ShortcutRecordEvent {
  return {
    phase,
    chord: binding.chord,
    timestamp,
  }
}

function syncGestureEngineEntries(): void {
  gestureEngine.updateEntries(
    Array.from(registeredShortcuts.values()).map((shortcut): ShortcutGestureRuntimeEntry<KeyboardGestureBinding> => ({
      id: shortcut.id,
      binding: shortcut.binding,
      canStart: shortcut.canStart,
    })),
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

function isPaused(): boolean {
  return isSuspended()
}

export type KeyboardGestureShortcutConfig = {
  /** action id，用于隔离每个绑定的 runtime 状态 */
  id: string
  /** 已持久化的 keyboard binding */
  binding: KeyboardGestureBinding
  /** 返回 false 时本次 keydown 不进入手势状态机 */
  canStart?: () => boolean
  /** press / doublePress / hold 触发时调用 */
  onTrigger: (gesture: ShortcutGestureType) => void
  /** hold 释放时调用 */
  onRelease?: (gesture: Extract<ShortcutGestureType, 'hold'>) => void
}

type KeyboardGestureBinding = ShortcutBinding & { chord: KeyboardShortcutChord }

type RegisteredKeyboardGestureShortcut = KeyboardGestureShortcutConfig & {
  match: KeyboardChordMatch
}

type KeyboardChordMatch = {
  mainKeyGroup: number[]
  requiredModifiers: Set<ModifierState>
}

type ModifierState = 'meta' | 'control' | 'alt' | 'shift'

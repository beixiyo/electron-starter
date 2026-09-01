import type {
  KeyboardModifierCode,
  KeyboardShortcutChord,
  KeyboardShortcutModifier,
  ShortcutBinding,
  ShortcutGestureRuntimeEntry,
  ShortcutGestureType,
  ShortcutModifier,
  ShortcutRuntimeEvent,
} from '@shared/shortcuts'
import type { UiohookKeyboardEvent } from 'uiohook-napi'
import {
  createShortcutGestureEngine,
  isKeyboardModifierCode,
  KEYBOARD_MODIFIER_CODES,
  keyboardShortcutChordMatchesModifierState,
} from '@shared/shortcuts'
import { createMainDiagnosticLogger } from '../../logging'
import { resolveKeyGroup } from '../hold/resolve-key-group'
import {
  addShortcutRuntimeSuspensionListener,
  isShortcutRuntimeSuspended,
} from '../suspension'
import { acquireHook, addUiohookKeyboardListeners, releaseHook } from '../uiohook-lifecycle'

/** action id → 已解析的 keyboard gesture 注册项 */
const registeredShortcuts = new Map<string, RegisteredKeyboardGestureShortcut>()
const pressedKeycodes = new Set<number>()
const log = createMainDiagnosticLogger('shortcut.runtime')

/** 当前 backend 是否已经占用 uIOhook lifecycle 引用计数 */
let hookAcquired = false

/** 当前 backend 的 Worker 事件订阅清理函数 */
let removeHookListeners: (() => void) | null = null

const gestureEngine = createShortcutGestureEngine<KeyboardGestureBinding>({
  entries: [],
  isPaused: isShortcutRuntimeSuspended,
  emit: emitKeyboardGestureEvent,
})

/** backend 与应用同生命周期；暂停只清输入状态，不改 uiohook listener/refcount */
addShortcutRuntimeSuspensionListener(() => {
  pressedKeycodes.clear()
  gestureEngine.cancelActiveGestures()
})

/**
 * 注册键盘手势快捷键
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
    log.error('keyboard-register.failed', '键盘手势快捷键注册失败', error, {
      id,
      key: binding.chord.key,
      gesture: binding.gesture,
    })
    return false
  }
}

/**
 * 取消所有键盘手势快捷键，并清理按键状态
 */
export function unregisterKeyboardGestureShortcuts(): void {
  gestureEngine.updateEntries([])
  registeredShortcuts.clear()
  pressedKeycodes.clear()
  maybeStopHook()
}

/**
 * 清理键盘手势快捷键状态
 * 用于应用退出或重注册前释放 timer / uIOhook listener
 */
export function resetKeyboardGestureShortcutStates(): void {
  unregisterKeyboardGestureShortcuts()
}

function handleKeyDown(event: UiohookKeyboardEvent): void {
  if (isShortcutRuntimeSuspended())
    return

  pressedKeycodes.add(event.keycode)
  const timestamp = Date.now()
  const modifierState = getModifierState(event)
  for (const shortcut of registeredShortcuts.values()) {
    if (!keyboardShortcutChordMatchesModifierState(
      shortcut.binding.chord,
      modifierState.physical,
      modifierState.logical,
    )) {
      gestureEngine.cancelChord(shortcut.binding.chord)
      continue
    }
    if (!isKeyWithinGroups(event.keycode, shortcut.match.mainKeyGroup))
      continue

    gestureEngine.handle({
      phase: 'down',
      chord: shortcut.binding.chord,
      timestamp,
    })
  }
}

function handleKeyUp(event: UiohookKeyboardEvent): void {
  if (isShortcutRuntimeSuspended())
    return

  pressedKeycodes.delete(event.keycode)
  const timestamp = Date.now()
  const modifierState = getModifierState(event)
  for (const shortcut of registeredShortcuts.values()) {
    const modifiersMatch = keyboardShortcutChordMatchesModifierState(
      shortcut.binding.chord,
      modifierState.physical,
      modifierState.logical,
    )
    const mainKeyReleased = isKeyWithinGroups(event.keycode, shortcut.match.mainKeyGroup)
    const modifierReleased = !modifiersMatch
      && isKeyWithinGroups(event.keycode, shortcut.match.modifierKeyGroup)

    if (mainKeyReleased || modifierReleased) {
      gestureEngine.handle({
        phase: 'up',
        chord: shortcut.binding.chord,
        timestamp,
      })
    }

    if (!modifiersMatch)
      gestureEngine.cancelChord(shortcut.binding.chord)
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
  const modifierKeyGroup = resolveModifierKeyGroup(chord.modifiers)

  if (isKeyboardModifierCode(chord.key)) {
    return {
      /** 纯修饰键组合由最后按下的任一成员完成，同时每个物理成员仍严格匹配侧别 */
      mainKeyGroup: resolveModifierChordKeyGroup(chord),
      modifierKeyGroup: Array.from(new Set([
        ...resolveKeyGroup(chord.key),
        ...modifierKeyGroup,
      ])),
    }
  }

  return {
    mainKeyGroup: resolveKeyGroup(chord.key),
    modifierKeyGroup,
  }
}

function getModifierState(
  event: UiohookKeyboardEvent,
): KeyboardModifierState {
  const physical = new Set<KeyboardModifierCode>()
  for (const modifier of KEYBOARD_MODIFIER_CODES) {
    if (resolveKeyGroup(modifier).some(keycode => pressedKeycodes.has(keycode)))
      physical.add(modifier)
  }

  const logical: ShortcutModifier[] = []
  if (event.metaKey)
    logical.push('Meta')
  if (event.ctrlKey)
    logical.push('Control')
  if (event.altKey)
    logical.push('Alt')
  if (event.shiftKey)
    logical.push('Shift')

  return { logical, physical }
}

function resolveModifierChordKeyGroup(chord: KeyboardShortcutChord): number[] {
  const groups = [
    ...resolveKeyGroup(chord.key),
    ...resolveModifierKeyGroup(chord.modifiers),
  ]

  return Array.from(new Set(groups))
}

function resolveModifierKeyGroup(modifiers: readonly KeyboardShortcutModifier[]): number[] {
  return modifiers.flatMap(modifier => resolveKeyGroup(resolveModifierToken(modifier)))
}

function resolveModifierToken(modifier: KeyboardShortcutModifier): string {
  if (modifier !== 'Primary')
    return modifier

  return process.platform === 'darwin'
    ? 'Meta'
    : 'Control'
}

function isKeyWithinGroups(keycode: number, group: number[]): boolean {
  return group.includes(keycode)
}

function ensureHookRunning(): void {
  if (!removeHookListeners) {
    removeHookListeners = addUiohookKeyboardListeners({
      keydown: handleKeyDown,
      keyup: handleKeyUp,
    })
  }

  if (!hookAcquired) {
    acquireHook()
    hookAcquired = true
  }
}

function maybeStopHook(): void {
  if (registeredShortcuts.size > 0)
    return

  removeHookListeners?.()
  removeHookListeners = null

  if (hookAcquired) {
    releaseHook()
    hookAcquired = false
  }
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
  modifierKeyGroup: number[]
}

type KeyboardModifierState = {
  logical: ShortcutModifier[]
  physical: Set<KeyboardModifierCode>
}

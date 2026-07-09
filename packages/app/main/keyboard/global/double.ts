import type { UiohookKeyboardEvent } from 'uiohook-napi'
import type { DoublePressGlobalShortcutConfig, DoublePressShortcutConfig } from '../types'
import { DOUBLE_PRESS_INTERVAL_MS } from '@shared'
import { uIOhook } from 'uiohook-napi'
import { logError } from '../../utils/logger'
import { windowManager } from '../../window-manager'
import { resolveKeyGroup } from '../hold/resolve-key-group'
import { checkAndWarnShortcutConflict, formatShortcutLogInfo } from '../shortcut-utils'
import { acquireHook, releaseHook } from '../uiohook-lifecycle'

const doublePressShortcuts = new Map<string, RegisteredDoublePressShortcutConfig>()
const lastPressTime = new Map<string, number>()
const singlePressTimers = new Map<string, ReturnType<typeof setTimeout>>()
const activeAccelerators = new Set<string>()

let hookAcquired = false
let listenerBound = false

/**
 * 注册双击全局快捷键
 * 两次按下间隔 ≤ DOUBLE_PRESS_INTERVAL_MS 视为双击
 * @returns 是否注册成功
 */
export function registerDoublePressGlobalShortcut(config: DoublePressGlobalShortcutConfig): boolean {
  const { accelerator, windowType, intervalMs = DOUBLE_PRESS_INTERVAL_MS, onFirstPress, onDoublePress } = config
  let match: AcceleratorMatch

  try {
    match = parseAccelerator(accelerator)
  }
  catch (error) {
    logError('双击全局快捷键解析失败', error, {
      module: 'shortcuts',
      operation: 'registerDoublePressGlobalShortcut',
      context: { accelerator },
    })
    return false
  }

  if (doublePressShortcuts.has(accelerator)) {
    const existingConfig = doublePressShortcuts.get(accelerator)
    if (checkAndWarnShortcutConflict(accelerator, existingConfig, '双击快捷键')) {
      unregisterDoublePressGlobalShortcut(accelerator)
    }
  }

  doublePressShortcuts.set(accelerator, {
    accelerator,
    windowType,
    intervalMs,
    onFirstPress,
    onDoublePress,
    match,
  })
  ensureHookRunning()

  const logInfo = formatShortcutLogInfo({
    shortcutType: '双击全局快捷键',
    accelerator,
    windowType,
    hasCallback: !!(onFirstPress || onDoublePress),
    callbackLabel: '回调函数',
  })
  console.log(logInfo)

  return true
}

/**
 * 取消注册双击全局快捷键
 */
export function unregisterDoublePressGlobalShortcut(accelerator: string): void {
  doublePressShortcuts.delete(accelerator)
  activeAccelerators.delete(accelerator)
  lastPressTime.delete(accelerator)

  const timer = singlePressTimers.get(accelerator)
  if (timer) {
    clearTimeout(timer)
    singlePressTimers.delete(accelerator)
  }

  maybeStopHook()
  console.log(`双击全局快捷键已取消注册: ${accelerator}`)
}

/**
 * 获取双击快捷键配置映射表（用于清理）
 * @internal
 */
export function getDoublePressShortcutsMap(): Map<string, DoublePressShortcutConfig> {
  return doublePressShortcuts
}

/**
 * 清理所有双击快捷键状态
 */
export function resetDoublePressShortcutStates(): void {
  singlePressTimers.forEach(clearTimeout)
  singlePressTimers.clear()
  lastPressTime.clear()
  activeAccelerators.clear()
  doublePressShortcuts.clear()
  maybeStopHook()
}

function handleKeyDown(event: UiohookKeyboardEvent): void {
  for (const [accelerator, config] of doublePressShortcuts.entries()) {
    if (!matchesAccelerator(event, config.match))
      continue
    if (activeAccelerators.has(accelerator))
      continue

    activeAccelerators.add(accelerator)
    handleShortcutPress(accelerator, config)
  }
}

function handleKeyUp(event: UiohookKeyboardEvent): void {
  for (const [accelerator, config] of doublePressShortcuts.entries()) {
    if (isKeyWithinAccelerator(event.keycode, config.match.keyGroups))
      activeAccelerators.delete(accelerator)
  }
}

function handleShortcutPress(accelerator: string, config: RegisteredDoublePressShortcutConfig): void {
  const { windowType, intervalMs = DOUBLE_PRESS_INTERVAL_MS, onFirstPress, onDoublePress } = config
  const now = Date.now()
  const last = lastPressTime.get(accelerator) ?? 0
  const existingTimer = singlePressTimers.get(accelerator)
  const isDouble = existingTimer !== undefined && now - last <= intervalMs

  if (isDouble) {
    clearTimeout(existingTimer)
    singlePressTimers.delete(accelerator)
    lastPressTime.delete(accelerator)
    onDoublePress?.()

    if (windowType) {
      try {
        windowManager.toggle(windowType)
      }
      catch (error) {
        logError('切换窗口失败', error, {
          module: 'shortcuts',
          operation: 'registerDoublePressGlobalShortcut',
          context: { accelerator, windowType },
        })
      }
    }
    return
  }

  if (existingTimer)
    clearTimeout(existingTimer)
  lastPressTime.set(accelerator, now)
  singlePressTimers.set(
    accelerator,
    setTimeout(() => {
      singlePressTimers.delete(accelerator)
      onFirstPress?.()
    }, intervalMs),
  )
}

function matchesAccelerator(event: UiohookKeyboardEvent, match: AcceleratorMatch): boolean {
  return match.mainKeyGroup.includes(event.keycode)
    && matchesModifiers(event, match.requiredModifiers)
}

function matchesModifiers(event: UiohookKeyboardEvent, requiredModifiers: Set<ModifierState>): boolean {
  return event.metaKey === requiredModifiers.has('meta')
    && event.ctrlKey === requiredModifiers.has('control')
    && event.altKey === requiredModifiers.has('alt')
    && event.shiftKey === requiredModifiers.has('shift')
}

function isKeyWithinAccelerator(keycode: number, keyGroups: number[][]): boolean {
  return keyGroups.some(group => group.includes(keycode))
}

function parseAccelerator(accelerator: string): AcceleratorMatch {
  const tokens = accelerator.split('+').map(token => token.trim()).filter(Boolean)
  if (!tokens.length)
    throw new Error(`非法的快捷键: ${accelerator}`)

  let mainKeyGroup: number[] | null = null
  const keyGroups: number[][] = []
  const requiredModifiers = new Set<ModifierState>()

  for (const token of tokens) {
    const keyGroup = resolveKeyGroup(token)
    const modifier = getModifierState(token)
    keyGroups.push(keyGroup)

    if (modifier) {
      requiredModifiers.add(modifier)
      continue
    }

    if (mainKeyGroup)
      throw new Error(`双击快捷键只能包含一个主按键: ${accelerator}`)

    mainKeyGroup = keyGroup
  }

  if (!mainKeyGroup)
    throw new Error(`双击快捷键缺少主按键: ${accelerator}`)

  return { keyGroups, mainKeyGroup, requiredModifiers }
}

function getModifierState(rawToken: string): ModifierState | null {
  const normalized = rawToken.replace(/[\s_-]/g, '').toLowerCase()

  switch (normalized) {
    case 'commandorcontrol':
    case 'cmdorctrl':
    case 'cmdorcontrol':
    case 'commandorctrl':
    case 'ctrlorcmd':
    case 'controlorcommand':
      return process.platform === 'darwin'
        ? 'meta'
        : 'control'
    case 'command':
    case 'cmd':
    case 'meta':
    case 'super':
    case 'win':
    case 'windows':
      return 'meta'
    case 'control':
    case 'ctrl':
      return 'control'
    case 'alt':
    case 'option':
    case 'altgr':
      return 'alt'
    case 'shift':
      return 'shift'
  }

  return null
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
  if (doublePressShortcuts.size > 0)
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

type RegisteredDoublePressShortcutConfig = DoublePressShortcutConfig & {
  accelerator: string
  match: AcceleratorMatch
}

type AcceleratorMatch = {
  keyGroups: number[][]
  mainKeyGroup: number[]
  requiredModifiers: Set<ModifierState>
}

type ModifierState = 'meta' | 'control' | 'alt' | 'shift'

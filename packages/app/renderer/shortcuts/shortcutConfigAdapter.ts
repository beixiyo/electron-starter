import type {
  ShortcutBindings,
  ShortcutRecordEvent,
  ShortcutRuntimeCapabilities,
  ShortcutRuntimeEvent,
} from '@shared/shortcuts'
import {
  DEFAULT_BINDINGS,
  DEFAULT_KEYBOARD_BINDINGS,
  filterShortcutBindingsByCapabilities,
  normalizeShortcutBindings,
  normalizeShortcutBindingsOrThrow,
  resolveShortcutBindingConflicts,
  SHORTCUT_ACTIONS,
  WEB_SHORTCUT_CAPABILITIES,
} from '@shared/shortcuts'
import { isElectron } from '@/utils/env'
import { bindBrowserShortcutRecordEvents } from './browserRecordEvent'

const WEB_SHORTCUT_BINDINGS_KEY = 'shortcut-bindings'
const RECORD_EVENT_DEDUP_MS = 120
const FN_KEYBOARD_DISAMBIGUATION_MS = 120
const bindingListeners = new Set<() => void>()

let shortcutRuntimePaused = false

/**
 * 读取快捷键配置。
 * Electron 桌面使用主进程持久化；Web 预览使用 localStorage 保持同一套 renderer 代码可运行
 */
export async function getShortcutBindings(): Promise<ShortcutBindings> {
  const ipc = getShortcutConfigIpc()
  if (ipc)
    return ipc.getBindings()

  return readWebShortcutBindings()
}

/** 当前运行环境下可用的默认快捷键绑定 */
export async function getShortcutDefaultBindings(): Promise<ShortcutBindings> {
  const ipc = getShortcutConfigIpc()
  if (ipc) {
    const capabilities = await ipc.getCapabilities()
    return filterShortcutBindingsByCapabilities(DEFAULT_BINDINGS, capabilities)
  }

  return toWebShortcutBindings(DEFAULT_KEYBOARD_BINDINGS)
}

/**
 * 保存快捷键配置。
 * Web 平台只能保存页面内快捷键配置，不能注册系统级全局快捷键
 */
export async function setShortcutBindings(bindings: ShortcutBindings): Promise<void> {
  const normalized = normalizeShortcutBindingsOrThrow(bindings)
  const ipc = getShortcutConfigIpc()
  if (ipc) {
    await ipc.setBindings(normalized)
    emitShortcutBindingsChanged()
    return
  }

  writeWebShortcutBindings(toWebShortcutBindings(normalized))
  emitShortcutBindingsChanged()
}

/** 当前实际可用的快捷键捕获能力，含权限与 native backend 状态，用于判定窗口内 runtime 该认领什么 */
export async function getShortcutRuntimeCapabilities(): Promise<ShortcutRuntimeCapabilities> {
  const ipc = getShortcutConfigIpc()
  if (ipc)
    return ipc.getRuntimeCapabilities()

  return WEB_SHORTCUT_CAPABILITIES
}

/**
 * 把窗口内捕获到的快捷键交给业务执行。
 *
 * 桌面端业务动作都在主进程，渲染端只做捕获；Web 端暂无对应业务，由调用方自行接管
 */
export async function triggerShortcutAction(event: ShortcutRuntimeEvent): Promise<void> {
  await getShortcutConfigIpc()?.trigger({ id: event.id, phase: event.phase })
}

/** 订阅快捷键配置或运行时能力变更，供运行时重新加载绑定 */
export function subscribeShortcutBindings(listener: () => void): () => void {
  bindingListeners.add(listener)

  const handleStorage = (event: StorageEvent) => {
    if (event.key === WEB_SHORTCUT_BINDINGS_KEY)
      listener()
  }

  window.addEventListener('storage', handleStorage)
  const offRuntimeChanged = getShortcutConfigIpc()?.on('runtimeChanged', () => listener())

  return () => {
    bindingListeners.delete(listener)
    window.removeEventListener('storage', handleStorage)
    offRuntimeChanged?.()
  }
}

/** Web local runtime 录制期间暂停快捷键触发，避免录制动作被当前配置抢走 */
export function isShortcutRuntimePaused(): boolean {
  return shortcutRuntimePaused
}

/** 进入录制态前暂停桌面全局快捷键；Web 环境暂停 local runtime */
export async function pauseShortcutRecord(): Promise<void> {
  shortcutRuntimePaused = true
  try {
    await getShortcutConfigIpc()?.pauseForRecord()
  }
  catch (error) {
    shortcutRuntimePaused = false
    throw error
  }
}

/** 结束录制态后恢复桌面全局快捷键；Web 环境恢复 local runtime */
export async function resumeShortcutRecord(): Promise<void> {
  try {
    await getShortcutConfigIpc()?.resumeAfterRecord()
  }
  finally {
    shortcutRuntimePaused = false
  }
}

/**
 * 绑定录制事件源。
 * Electron 桌面走 IPC + native/uIOhook，Web 走 DOM KeyboardEvent fallback
 */
export function bindShortcutRecordEvents(options: BindShortcutRecordEventsOptions): () => void {
  const { emit, onReset } = options
  const cleanupFns: Array<() => void> = []
  let fnActive = false
  let suppressKeyboardUntil = 0
  let recentKeyboardEvent: ShortcutRecordEvent | null = null
  const pendingKeyboardTimers = new Set<ReturnType<typeof setTimeout>>()

  /** native/uIOhook 与 DOM fallback 可能同时报告同一个物理按键，只交给录制状态机一次 */
  const emitRecordEvent = (event: ShortcutRecordEvent): void => {
    if (event.chord.source === 'keyboard') {
      if (recentKeyboardEvent
        && recentKeyboardEvent.phase === event.phase
        && recentKeyboardEvent.chord.source === 'keyboard'
        && recentKeyboardEvent.chord.key === event.chord.key
        && JSON.stringify(recentKeyboardEvent.chord.modifiers) === JSON.stringify(event.chord.modifiers)
        && Math.abs(event.timestamp - recentKeyboardEvent.timestamp) <= RECORD_EVENT_DEDUP_MS) {
        return
      }
      recentKeyboardEvent = event
    }

    emit(event)
  }

  /** 等待独立的 Fn native 事件源先到达，避免把 Fn combo 同时录成普通 keyboard */
  const emitKeyboardRecordEvent = (event: ShortcutRecordEvent): void => {
    const timer = setTimeout(() => {
      pendingKeyboardTimers.delete(timer)
      if (fnActive || Date.now() < suppressKeyboardUntil)
        return
      emitRecordEvent(event)
    }, FN_KEYBOARD_DISAMBIGUATION_MS)
    pendingKeyboardTimers.add(timer)
  }

  if (isElectron()) {
    const ipc = window.$ipc
    cleanupFns.push(
      ipc.fn.on('raw', (event) => {
        if (event.type === 'reset') {
          fnActive = false
          suppressKeyboardUntil = 0
          recentKeyboardEvent = null
          onReset()
          return
        }

        if (event.chord.key === 'Fn')
          fnActive = event.phase === 'down'
        suppressKeyboardUntil = Date.now() + FN_KEYBOARD_DISAMBIGUATION_MS

        emitRecordEvent({
          phase: event.phase,
          chord: event.chord,
          timestamp: event.timestamp,
        })
      }),
      ipc.shortcutConfig.on('record', (event) => {
        /** Fn combo 已由 native helper 合成为 fn chord，忽略同一物理动作产生的底层 keyboard 噪音 */
        emitKeyboardRecordEvent(event)
      }),
    )

    /** uIOhook 不可用时普通 keyboard 仍可在设置页通过 DOM 录制；Fn 事件仍只依赖 native */
    cleanupFns.push(bindBrowserShortcutRecordEvents((event) => {
      emitKeyboardRecordEvent(event)
    }))
  }
  else {
    cleanupFns.push(bindBrowserShortcutRecordEvents(emitRecordEvent))
  }

  return () => {
    pendingKeyboardTimers.forEach(clearTimeout)
    pendingKeyboardTimers.clear()
    for (const cleanup of cleanupFns)
      cleanup()
  }
}

type BindShortcutRecordEventsOptions = {
  emit: (event: ShortcutRecordEvent) => void
  onReset: () => void
}

function getShortcutConfigIpc(): Window['$ipc']['shortcutConfig'] | null {
  return isElectron()
    ? window.$ipc.shortcutConfig
    : null
}

function readWebShortcutBindings(): ShortcutBindings {
  try {
    const raw = window.localStorage.getItem(WEB_SHORTCUT_BINDINGS_KEY)
    if (!raw)
      return toWebShortcutBindings(DEFAULT_KEYBOARD_BINDINGS)

    const parsed = JSON.parse(raw) as ShortcutBindings
    return toWebShortcutBindings({ ...DEFAULT_KEYBOARD_BINDINGS, ...parsed })
  }
  catch {
    return toWebShortcutBindings(DEFAULT_KEYBOARD_BINDINGS)
  }
}

function writeWebShortcutBindings(bindings: ShortcutBindings): void {
  try {
    window.localStorage.setItem(WEB_SHORTCUT_BINDINGS_KEY, JSON.stringify(bindings))
  }
  catch {}
}

function toWebShortcutBindings(bindings: ShortcutBindings): ShortcutBindings {
  const normalized = resolveShortcutBindingConflicts(normalizeShortcutBindings(bindings))
  const actionBindings: ShortcutBindings = Object.fromEntries(
    SHORTCUT_ACTIONS.map((action) => {
      const binding = normalized[action.id]
      return [
        action.id,
        binding
          ? { ...binding, scope: action.scope }
          : null,
      ]
    }),
  )

  return actionBindings
}

function emitShortcutBindingsChanged(): void {
  for (const listener of bindingListeners)
    listener()
}

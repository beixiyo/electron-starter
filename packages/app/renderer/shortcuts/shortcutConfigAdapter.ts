import type {
  ShortcutBindings,
  ShortcutRecordEvent,
  ShortcutRuntimeCapabilities,
} from '@shared/shortcuts'
import {
  cloneShortcutRuntimeCapabilities,
  DEFAULT_BINDINGS,
  filterShortcutBindingsByCapabilities,
  normalizeShortcutBindings,
  resolveShortcutBindingConflicts,
  WEB_SHORTCUT_CAPABILITIES,
} from '@shared/shortcuts'
import { isElectron } from '@/utils/env'
import { bindBrowserShortcutRecordEvents } from './browserRecordEvent'

const WEB_SHORTCUT_BINDINGS_KEY = 'shortcut-bindings'
const FN_COMBO_KEYBOARD_SUPPRESS_MS = 120

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

  return toWebShortcutBindings(DEFAULT_BINDINGS)
}

/**
 * 保存快捷键配置。
 * Web 平台只能保存页面内快捷键配置，不能注册系统级全局快捷键
 */
export async function setShortcutBindings(bindings: ShortcutBindings): Promise<void> {
  const ipc = getShortcutConfigIpc()
  if (ipc) {
    await ipc.setBindings(normalizeShortcutBindings(bindings))
    emitShortcutBindingsChanged()
    return
  }

  writeWebShortcutBindings(toWebShortcutBindings(bindings))
  emitShortcutBindingsChanged()
}

/** 当前运行环境的快捷键捕获能力 */
export async function getShortcutCapabilities(): Promise<ShortcutRuntimeCapabilities> {
  const ipc = getShortcutConfigIpc()
  if (ipc)
    return ipc.getCapabilities()

  return cloneShortcutRuntimeCapabilities(WEB_SHORTCUT_CAPABILITIES)
}

/** 订阅快捷键配置变更，供运行时重新加载绑定 */
export function subscribeShortcutBindings(listener: () => void): () => void {
  bindingListeners.add(listener)

  const handleStorage = (event: StorageEvent) => {
    if (event.key === WEB_SHORTCUT_BINDINGS_KEY)
      listener()
  }

  window.addEventListener('storage', handleStorage)

  return () => {
    bindingListeners.delete(listener)
    window.removeEventListener('storage', handleStorage)
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
export function bindShortcutRecordEvents(emit: (event: ShortcutRecordEvent) => void): () => void {
  const cleanupFns: Array<() => void> = []
  const ipc = getElectronIpc()
  let fnActive = false
  let suppressKeyboardUntil = 0

  if (ipc?.fn) {
    cleanupFns.push(
      ipc.fn.on('down', () => {
        fnActive = true
        emit({
          phase: 'down',
          chord: { source: 'fn', key: 'Fn' },
          timestamp: Date.now(),
        })
      }),
      ipc.fn.on('up', () => {
        fnActive = false
        emit({
          phase: 'up',
          chord: { source: 'fn', key: 'Fn' },
          timestamp: Date.now(),
        })
      }),
      ipc.fn.on('combo', ({ key, modifiers }) => {
        suppressKeyboardUntil = Date.now() + FN_COMBO_KEYBOARD_SUPPRESS_MS
        emit({
          phase: 'press',
          chord: { source: 'fn', key, modifiers },
          timestamp: Date.now(),
        })
      }),
    )
  }

  if (ipc?.shortcutConfig) {
    cleanupFns.push(ipc.shortcutConfig.on('record', (event) => {
      /** Fn combo 已由 native helper 合成为 fn chord，忽略同一物理动作产生的底层 keyboard 噪音 */
      if (fnActive || Date.now() < suppressKeyboardUntil)
        return

      emit(event)
    }))
  }
  else {
    cleanupFns.push(bindBrowserShortcutRecordEvents(emit))
  }

  return () => {
    for (const cleanup of cleanupFns)
      cleanup()
  }
}

function getShortcutConfigIpc(): Window['$ipc']['shortcutConfig'] | null {
  return isElectron()
    ? window.$ipc.shortcutConfig
    : null
}

function getElectronIpc(): Window['$ipc'] | null {
  return isElectron()
    ? window.$ipc
    : null
}

function readWebShortcutBindings(): ShortcutBindings {
  try {
    const raw = window.localStorage.getItem(WEB_SHORTCUT_BINDINGS_KEY)
    if (!raw)
      return toWebShortcutBindings(DEFAULT_BINDINGS)

    const parsed = JSON.parse(raw) as ShortcutBindings
    return toWebShortcutBindings({ ...DEFAULT_BINDINGS, ...parsed })
  }
  catch {
    return toWebShortcutBindings(DEFAULT_BINDINGS)
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
  const localBindings: ShortcutBindings = Object.fromEntries(
    Object.entries(normalized).map(([id, binding]) => [
      id,
      binding
        ? { ...binding, scope: 'local' as const }
        : null,
    ]),
  )

  return filterShortcutBindingsByCapabilities(localBindings, WEB_SHORTCUT_CAPABILITIES)
}

function emitShortcutBindingsChanged(): void {
  for (const listener of bindingListeners)
    listener()
}

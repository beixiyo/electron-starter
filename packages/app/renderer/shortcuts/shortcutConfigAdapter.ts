/** 快捷键配置持久化、变更订阅与录制事件来源的跨平台适配 */
import type { ShortcutRecordSession } from '@ipc/services/shortcut-config/contract'
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
const bindingListeners = new Set<() => void>()

let shortcutRuntimePaused = false

export type { ShortcutRecordSession }

/** 读取快捷键配置：桌面使用主进程持久化，Web 预览使用 localStorage */
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

/**
 * 进入录制态前暂停桌面全局快捷键；Web 环境暂停 local runtime
 *
 * @returns 本轮录制的捕获归属；Web 或主进程接管失败时由 DOM 产出录制事件
 */
export async function pauseShortcutRecord(): Promise<ShortcutRecordSession> {
  shortcutRuntimePaused = true
  try {
    return (await getShortcutConfigIpc()?.pauseForRecord()) ?? { nativeCapture: false, systemShortcuts: [] }
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
 * 绑定录制事件源
 *
 * 主进程接管时 Fn 组合与普通键盘来自同一条 IPC 事件流，DOM 层只吞按键；
 * 否则由 DOM 产出录制事件。裸 Esc 不是取消键，与其他键一样交给设置页校验
 */
export function bindShortcutRecordEvents(options: BindShortcutRecordEventsOptions): () => void {
  const { emit, onReset, nativeCapture } = options
  const cleanups: Array<() => void> = []

  const ipc = getShortcutConfigIpc()
  if (ipc && nativeCapture) {
    cleanups.push(
      ipc.on('record', emit),
      ipc.on('recordReset', () => onReset()),
    )
  }

  cleanups.push(bindBrowserShortcutRecordEvents(
    nativeCapture
      ? {}
      : { emit },
  ))

  return () => {
    for (const cleanup of cleanups)
      cleanup()
  }
}

type BindShortcutRecordEventsOptions = {
  /** 主进程是否已接管系统级捕获；见 {@link ShortcutRecordSession.nativeCapture} */
  nativeCapture: boolean
  emit: (event: ShortcutRecordEvent) => void
  /** 捕获后端丢失物理状态时清空本轮录制 */
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
  window.localStorage.setItem(WEB_SHORTCUT_BINDINGS_KEY, JSON.stringify(bindings))
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

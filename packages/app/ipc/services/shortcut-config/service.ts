import type { ShortcutBindings, ShortcutRuntimeEvent } from '@shared/shortcuts'
import type { IpcMainInvokeEvent } from 'electron'
import type { ShortcutConfigContract, ShortcutTriggerRequest } from './contract'
import { createIpcService } from '@ipc/core'
import {
  filterPersistableShortcutBindings,
  getElectronShortcutCapabilities,
  getElectronShortcutRuntimeCapabilities,
  isShortcutRuntimeSuspended,
  resolveRuntimeShortcutBindings,
  resumeShortcutRuntime,
  startRecordShortcutDetection,
  stopRecordShortcutDetection,
  suspendShortcutRuntime,
} from '@main/shortcuts'
import { normalizeShortcutBindingsForWrite, readShortcutBindings, writeShortcutBindings } from '@main/store/shortcut-bindings'
import { windowManager } from '@main/window-manager'
import { BrowserWindow } from 'electron'

let emitRuntimeChanged: (() => void) | null = null
let releaseActiveLocalHold: ((event: ShortcutRuntimeEvent) => void) | null = null
const activeLocalHolds = new Map<string, ActiveLocalHold>()
let recordOwnerId: number | null = null

/**
 * 通知所有渲染进程重新认领窗口内快捷键。
 *
 * 权限变化会改变 global / local 的降级结果，渲染端必须同步撤下或接管，
 * 否则会出现 main 与 renderer 同时监听导致的双触发
 */
export function notifyShortcutRuntimeChanged(): void {
  clearActiveLocalHolds()
  emitRuntimeChanged?.()
}

export function createShortcutConfigService(options: CreateShortcutConfigServiceOptions): void {
  const { onReapply, onTrigger } = options
  clearActiveLocalHolds()
  releaseActiveLocalHold = onTrigger

  const service = createIpcService<ShortcutConfigContract>('shortcut-config', {
    mainHandle: {
      async getBindings(_e) {
        return filterPersistableShortcutBindings(readShortcutBindings())
      },

      async setBindings(e, bindings) {
        if (!getTrustedMainWindow(e))
          return
        const nextBindings = filterPersistableShortcutBindings(
          normalizeShortcutBindingsForWrite(bindings),
        )
        clearActiveLocalHolds()
        writeShortcutBindings(nextBindings)
        onReapply(nextBindings)
      },

      async getCapabilities(_e) {
        return getElectronShortcutCapabilities()
      },

      async getRuntimeCapabilities(_e) {
        return getElectronShortcutRuntimeCapabilities()
      },

      async trigger(e, event) {
        /**
         * 以主进程当前解析结果为准，只接受确实降级到窗口内 keyboard 的动作。
         * 渲染端传来的 binding 不可信：直接采信会让它绕过权限门禁触发 global 动作
         */
        const request = normalizeShortcutTriggerRequest(event)
        if (!request)
          return

        const senderWindow = getSenderWindow(e)
        if (!senderWindow)
          return

        const { sender, win } = senderWindow
        const activeHold = activeLocalHolds.get(request.id)
        if (isShortcutRuntimeSuspended()
          && !(request.phase === 'release' && activeHold?.senderId === sender.id)) {
          return
        }
        /** 松开事件可能发生在窗口失焦之后，但只能结束同一发送方已建立的长按会话 */
        if (!win.isFocused()
          && !(request.phase === 'release' && activeHold?.senderId === sender.id)) {
          return
        }

        const binding = resolveRuntimeShortcutBindings(readShortcutBindings())[request.id]
        if (!binding || binding.scope !== 'local' || binding.chord.source !== 'keyboard')
          return

        if (request.phase === 'release' && binding.gesture !== 'hold')
          return

        const senderId = sender.id
        if (binding.gesture === 'hold') {
          if (request.phase === 'trigger') {
            if (activeHold)
              return
          }
          else if (activeHold?.senderId !== senderId) {
            return
          }
          else {
            activeHold.detach()
            activeLocalHolds.delete(request.id)
          }
        }

        const trustedEvent = {
          id: request.id,
          phase: request.phase,
          gesture: binding.gesture,
          binding,
        } satisfies ShortcutRuntimeEvent

        if (binding.gesture === 'hold' && request.phase === 'trigger') {
          const onSenderDestroyed = () => releaseActiveLocalHoldById(request.id)
          sender.once('destroyed', onSenderDestroyed)
          activeLocalHolds.set(request.id, {
            senderId,
            event: trustedEvent,
            detach: () => {
              if (!sender.isDestroyed())
                sender.off('destroyed', onSenderDestroyed)
            },
          })
        }

        try {
          onTrigger(trustedEvent)
        }
        catch (error) {
          if (binding.gesture === 'hold' && request.phase === 'trigger')
            removeActiveLocalHold(request.id)
          throw error
        }
      },

      async pauseForRecord(e) {
        const senderWindow = getTrustedMainWindow(e)
        if (!senderWindow || recordOwnerId !== null)
          return

        clearActiveLocalHolds()
        suspendShortcutRuntime()
        recordOwnerId = senderWindow.sender.id
        const win = senderWindow.win
        startRecordShortcutDetection((recordEvent) => {
          service.emit('record', recordEvent, win ?? undefined)
        })
        bindRecordAutoStop(win ?? undefined)
      },

      async resumeAfterRecord(e) {
        const senderWindow = getTrustedMainWindow(e)
        if (!senderWindow || senderWindow.sender.id !== recordOwnerId)
          return
        stopRecordDetection()
      },
    },
  })

  emitRuntimeChanged = () => service.emit('runtimeChanged', undefined)
}

function normalizeShortcutTriggerRequest(value: unknown): ShortcutTriggerRequest | null {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || (value.phase !== 'trigger' && value.phase !== 'release')) {
    return null
  }

  return {
    id: value.id,
    phase: value.phase,
  }
}

function getSenderWindow(event: unknown): SenderWindow | null {
  const sender = (event as IpcMainInvokeEvent | undefined)?.sender
  const senderFrame = (event as IpcMainInvokeEvent | undefined)?.senderFrame
  if (!sender || sender.isDestroyed() || !senderFrame || senderFrame !== sender.mainFrame)
    return null
  if (!isTrustedRendererUrl(senderFrame.url))
    return null

  try {
    const win = BrowserWindow.fromWebContents(sender)
    return win && !win.isDestroyed()
      ? { sender, win }
      : null
  }
  catch {
    return null
  }
}

function getTrustedMainWindow(event: unknown): SenderWindow | null {
  const senderWindow = getSenderWindow(event)
  const mainWindow = windowManager.getMainWindow()
  return senderWindow && mainWindow === senderWindow.win
    ? senderWindow
    : null
}

function isTrustedRendererUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === 'file:')
      return true
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  }
  catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clearActiveLocalHolds(): void {
  const holds = [...activeLocalHolds.values()]
  activeLocalHolds.clear()

  for (const { event, detach } of holds) {
    detach()
    releaseActiveLocalHold?.({ ...event, phase: 'release' })
  }
}

function releaseActiveLocalHoldById(id: string): void {
  const hold = activeLocalHolds.get(id)
  if (!hold)
    return

  activeLocalHolds.delete(id)
  hold.detach()
  releaseActiveLocalHold?.({ ...hold.event, phase: 'release' })
}

function removeActiveLocalHold(id: string): void {
  const hold = activeLocalHolds.get(id)
  hold?.detach()
  activeLocalHolds.delete(id)
}

type ActiveLocalHold = {
  senderId: number
  event: ShortcutRuntimeEvent
  detach: () => void
}

type SenderWindow = {
  sender: IpcMainInvokeEvent['sender']
  win: BrowserWindow
}

export type CreateShortcutConfigServiceOptions = {
  /** 绑定更新后回调，由 main/index.ts 注入重新注册快捷键的逻辑 */
  onReapply: (bindings: ShortcutBindings) => void
  /** 渲染进程捕获到窗口内快捷键后执行业务动作，binding 由主进程重新解析后传入 */
  onTrigger: (event: ShortcutRuntimeEvent) => void
}

let detachRecordAutoStop: (() => void) | null = null

/** 停止录制检测并恢复快捷键运行时，可由正常结束与窗口生命周期重复调用 */
function stopRecordDetection(): void {
  detachRecordAutoStop?.()
  detachRecordAutoStop = null
  stopRecordShortcutDetection()
  resumeShortcutRuntime()
  recordOwnerId = null
}

/** renderer 隐藏或销毁时自动结束录制，避免全局 hook 和暂停状态泄漏 */
function bindRecordAutoStop(win: BrowserWindow | undefined): void {
  detachRecordAutoStop?.()
  detachRecordAutoStop = null
  if (!win)
    return

  const onGone = () => stopRecordDetection()
  win.once('hide', onGone)
  win.webContents.once('destroyed', onGone)
  detachRecordAutoStop = () => {
    win.off('hide', onGone)
    if (!win.webContents.isDestroyed())
      win.webContents.off('destroyed', onGone)
  }
}

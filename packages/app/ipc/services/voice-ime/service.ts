/** Voice IME IPC handler、统一发起门禁与会话生命周期。 */

import { createIpcService } from '@ipc/core'
import { ensureMicrophonePermissionOrExplain } from '@main/permission-required'
import { ensureVoiceImeStorageAvailable } from '@main/recording-storage'
import { startVoiceImeEscapeWatcher, stopVoiceImeEscapeWatcher } from '@main/voice-ime-escape'
import { type VoiceImeDeliveryContext, voiceImeState } from '@main/voice-ime-state'
import { windowManager } from '@main/window-manager'
import {
  type VoiceImeCancelReason,
  type VoiceImeDeliverPayload,
  type VoiceImeMode,
  type VoiceImeSessionHost,
  type VoiceImeStartBlocker,
  type VoiceImeStartResult,
  WindowType,
} from '@shared'
import type { VoiceImeCompletionPayload, VoiceImeHostRegistrationOptions, VoiceImeStartResponse } from '@shared'
import { BrowserWindow, net } from 'electron'
import { randomUUID } from 'node:crypto'
import { VOICE_IME_NAMESPACE, type VoiceImeContract } from './contract'
import {
  clearVoiceImeSessionTarget,
  freezeVoiceImeSessionTarget,
  isResolvedVoiceImeSurfaceAvailable,
  registerVoiceImeEmbeddedHost,
  registerVoiceImeWindowHost,
  type ResolvedVoiceImeSurface,
  resolveVoiceImeSurface,
  setVoiceImeFocusContext,
  setVoiceImeSessionMode,
} from './state'
import { voiceImeToRenderer } from './toRenderer'

/** 投递器看到的冻结会话上下文；补投没有会话上下文。 */
export type VoiceImeTranscriptionDispatchContext = {
  sessionId: string | null
  owner: BrowserWindow | null
  surface: 'floating' | 'embedded' | null
  host: VoiceImeSessionHost | null
  mode: VoiceImeMode | null
}

/** 文本投递由宿主注入，避免 IPC service 反向依赖具体输入实现。 */
export type VoiceImeTranscriptionDispatcher = (
  payload: VoiceImeDeliverPayload,
  context: VoiceImeTranscriptionDispatchContext,
) => void | Promise<void>

/** 主进程可注册的同步发起门禁；策略模块只返回阻断原因，不拥有会话。 */
export type VoiceImeStartGuard = () => VoiceImeStartBlocker | null

const startGuards = new Set<VoiceImeStartGuard>()
let transcriptionDispatcher: VoiceImeTranscriptionDispatcher | null = null
let startGeneration = 0

/** 注册一个通用发起门禁，返回幂等注销函数。 */
export function registerVoiceImeStartGuard(guard: VoiceImeStartGuard): () => void {
  startGuards.add(guard)
  return () => {
    startGuards.delete(guard)
  }
}

/** 取消等待磁盘/权限检查的入口；物理按键和系统生命周期都可调用。 */
export function cancelPendingVoiceImeStart(): void {
  startGeneration += 1
}

/** 由 main 装配层注入统一文本投递实现。传 null 可撤销注入。 */
export function setVoiceImeTranscriptionDispatcher(dispatcher: VoiceImeTranscriptionDispatcher | null): void {
  transcriptionDispatcher = dispatcher
}

function getWindowFromEvent(event: unknown): BrowserWindow | null {
  const sender = (event as { sender?: Electron.WebContents } | undefined)?.sender
  if (!sender) return null

  let window: BrowserWindow | null
  try {
    window = BrowserWindow.fromWebContents(sender)
  }
  catch {
    return null
  }

  if (!window || window.isDestroyed()) return null
  return isManagedAppWindow(window)
    ? window
    : null
}

/** 只接受由本窗口管理器登记的应用窗口，拒绝外部 webContents 与授权窗口。 */
function isManagedAppWindow(window: BrowserWindow): boolean {
  for (const [type, managed] of windowManager.getAll()) {
    if (managed === window && type !== WindowType.OAUTH) return true
  }
  return false
}

function isManagedWindowOfType(window: BrowserWindow, type: WindowType): boolean {
  const managed = windowManager.get(type)
  return managed === window && !window.isDestroyed()
}

function isFocusContext(value: unknown): value is { editable: boolean; embeddedHost?: string } {
  if (!value || typeof value !== 'object') return false
  const context = value as { editable?: unknown; embeddedHost?: unknown }
  return typeof context.editable === 'boolean'
    && (context.embeddedHost === undefined || isValidHost(context.embeddedHost))
}

function isValidHost(host: unknown): host is VoiceImeSessionHost {
  return isValidSessionHost(host) && host !== 'window'
}

function isValidSessionHost(host: unknown): host is VoiceImeSessionHost {
  return typeof host === 'string' && host.trim().length > 0
}

function isHostRegistrationOptions(value: unknown): value is VoiceImeHostRegistrationOptions {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false

  const defaultValue = (value as { default?: unknown }).default
  return defaultValue === undefined || typeof defaultValue === 'boolean'
}

function isVoiceImeSessionBusy(): boolean {
  return voiceImeState.isActive || voiceImeState.hasSession
}

function getVoiceImeSessionTargetWindow(): BrowserWindow | null {
  const owner = voiceImeState.sessionContext?.owner
  if (owner && !owner.isDestroyed()) return owner

  const floatingWindow = windowManager.get(WindowType.VOICE_IME)
  return floatingWindow && !floatingWindow.isDestroyed()
    ? floatingWindow
    : null
}

function runStartGuards(): VoiceImeStartBlocker | null {
  for (const guard of startGuards) {
    try {
      const blocker = guard()
      if (blocker) return blocker
    }
    catch (error) {
      /** 门禁异常按阻断处理，避免检查失败时意外启动采集。 */
      console.error('[voice-ime] start guard failed', error)
      return 'aborted'
    }
  }
  return null
}

function findStartBlocker(): VoiceImeStartBlocker | null {
  const guardBlocker = runStartGuards()
  if (guardBlocker) return guardBlocker

  if (isVoiceImeSessionBusy()) return 'session'
  if (!net.isOnline()) return 'offline'
  return null
}

function getFloatingWindow(): BrowserWindow | null {
  const existing = windowManager.get(WindowType.VOICE_IME)
  if (existing && !existing.isDestroyed()) return existing
  return windowManager.create(WindowType.VOICE_IME) ?? null
}

function contextForSession(context: VoiceImeDeliveryContext): VoiceImeTranscriptionDispatchContext {
  return {
    sessionId: context.sessionId,
    owner: context.owner,
    surface: context.surface,
    host: context.host,
    mode: context.mode,
  }
}

function contextForSupplement(): VoiceImeTranscriptionDispatchContext {
  return {
    sessionId: null,
    owner: null,
    surface: null,
    host: null,
    mode: null,
  }
}

/** 没有注入器时仍把文本交给当前 Voice IME 承载，避免静默丢失。 */
async function dispatchTranscription(
  payload: VoiceImeDeliverPayload,
  context: VoiceImeTranscriptionDispatchContext,
): Promise<void> {
  if (transcriptionDispatcher) {
    await transcriptionDispatcher(payload, context)
    return
  }

  if (!payload.text.trim()) return

  if (context.surface === 'embedded' && context.owner && context.host) {
    voiceImeToRenderer.emit('embeddedTranscription', {
      host: context.host,
      text: payload.text,
      sessionId: context.sessionId ?? undefined,
    }, context.owner)
    return
  }

  const target = context.owner ?? getVoiceImeSessionTargetWindow()
  voiceImeToRenderer.emit('transcription', { text: payload.text }, target ?? undefined)
}

function emitActiveState(): void {
  voiceImeToRenderer.emit('activeChanged', voiceImeState.snapshot)
}

function promptCodeForBlocker(blocker: VoiceImeStartBlocker):
  | 'recordingBusy'
  | 'sessionBusy'
  | 'captureBlocked'
  | 'offline'
  | 'diskUnavailable'
  | 'permissionRequired' {
  switch (blocker) {
    case 'recording':
      return 'recordingBusy'
    case 'session':
      return 'sessionBusy'
    case 'capture':
      return 'captureBlocked'
    case 'offline':
      return 'offline'
    case 'disk':
      return 'diskUnavailable'
    case 'permission':
      return 'permissionRequired'
    case 'aborted':
      return 'sessionBusy'
  }
}

/** 按承载面把阻断结果转换成 renderer 能消费的提示事件。 */
function emitBlockedPrompt(resolved: ResolvedVoiceImeSurface, blocker: VoiceImeStartBlocker): void {
  if (resolved.surface === 'embedded' && isResolvedVoiceImeSurfaceAvailable(resolved)) {
    voiceImeToRenderer.emit('blockedPrompt', {
      host: resolved.host,
      code: promptCodeForBlocker(blocker),
    }, resolved.window)
    return
  }

  if (resolved.surface === 'floating') {
    const window = getFloatingWindow()
    if (window && !window.isDestroyed()) {
      scheduleFloatingEvent(window, () => voiceImeToRenderer.emit('status', { error: blocker }, window), {
        allowAfterSessionEnd: true,
      })
    }
  }
}

/** 统一把阻断结果推送给已经冻结的承载面；异步作废不产生迟到提示。 */
export function reportVoiceImeStartBlocked(
  blocker: VoiceImeStartBlocker,
  resolved: ResolvedVoiceImeSurface = resolveVoiceImeSurface(),
): void {
  if (blocker === 'aborted') return
  emitBlockedPrompt(resolved, blocker)
}

function blocked(
  blocker: VoiceImeStartBlocker,
  resolved: ResolvedVoiceImeSurface,
): VoiceImeStartResult {
  reportVoiceImeStartBlocked(blocker, resolved)
  return { started: false, blockedBy: blocker }
}

/**
 * 启动一轮语音输入的唯一门禁
 *
 * 承载面在第一次 await 前快照；磁盘检查早于权限；每个异步边界后检查入口代次、宿主存活和门禁
 */
export async function requestVoiceImeStart(
  options: RequestVoiceImeStartOptions = {},
): Promise<VoiceImeStartResult> {
  const generation = startGeneration
  const mode = options.mode ?? 'click'
  const resolvedSurface = options.resolvedSurface ?? resolveVoiceImeSurface()
  const initialBlocker = findStartBlocker()
  if (initialBlocker) return blocked(initialBlocker, resolvedSurface)

  if (!await ensureVoiceImeStorageAvailable()) {
    return blocked('disk', resolvedSurface)
  }

  if (!isStartGenerationCurrent(generation)) return blocked('aborted', resolvedSurface)
  if (options.shouldContinue && !options.shouldContinue()) return blocked('aborted', resolvedSurface)
  if (!isResolvedVoiceImeSurfaceAvailable(resolvedSurface)) return blocked('aborted', resolvedSurface)

  const afterStorageBlocker = findStartBlocker()
  if (afterStorageBlocker) return blocked(afterStorageBlocker, resolvedSurface)

  if (!await ensureMicrophonePermissionOrExplain('voice-ime')) {
    return blocked('permission', resolvedSurface)
  }

  if (!isStartGenerationCurrent(generation)) return blocked('aborted', resolvedSurface)
  if (options.shouldContinue && !options.shouldContinue()) return blocked('aborted', resolvedSurface)
  if (!isResolvedVoiceImeSurfaceAvailable(resolvedSurface)) return blocked('aborted', resolvedSurface)

  const finalBlocker = findStartBlocker()
  if (finalBlocker) return blocked(finalBlocker, resolvedSurface)

  const sessionId = startVoiceImeMode(mode, { resolvedSurface })
  if (!sessionId) return blocked('session', resolvedSurface)
  return { started: true, sessionId }
}

function isStartGenerationCurrent(generation: number): boolean {
  return generation === startGeneration
}

/** 使用已经冻结的承载面原子认领会话。 */
export function startVoiceImeMode(
  mode: VoiceImeMode,
  options: StartVoiceImeModeOptions = {},
): string | null {
  if (isVoiceImeSessionBusy()) return null

  const resolved = options.resolvedSurface ?? resolveVoiceImeSurface()
  const owner = resolved.surface === 'embedded'
    ? resolved.window
    : getFloatingWindow()
  if (!owner || owner.isDestroyed()) return null
  if (!isResolvedVoiceImeSurfaceAvailable(resolved)) return null

  const sessionId = randomUUID()
  if (
    !voiceImeState.openSession({
      sessionId,
      owner,
      surface: resolved.surface,
      host: resolved.host,
      mode,
    })
  ) return null

  if (!voiceImeState.setPhase('recording')) {
    voiceImeState.cancelSession(sessionId)
    return null
  }

  setVoiceImeSessionMode(mode)
  startVoiceImeEscapeWatcher(sessionId, (currentSessionId) => {
    cancelVoiceImeSession('escape', currentSessionId)
  })

  if (resolved.surface === 'embedded') {
    const floatingWindow = windowManager.get(WindowType.VOICE_IME)
    if (
      floatingWindow
      && floatingWindow !== resolved.window
      && !floatingWindow.isDestroyed()
      && floatingWindow.isVisible()
    ) {
      windowManager.hide(WindowType.VOICE_IME)
    }

    freezeVoiceImeSessionTarget(resolved.window, resolved.host)
    voiceImeToRenderer.emit('embeddedStart', {
      host: resolved.host,
      mode,
      sessionId,
    }, resolved.window)
  }
  else {
    windowManager.showInactive(WindowType.VOICE_IME)
    scheduleFloatingEvent(owner, () => {
      if (voiceImeState.currentSessionId !== sessionId || owner.isDestroyed()) return
      voiceImeToRenderer.emit('modeChanged', { mode, sessionId }, owner)
      voiceImeToRenderer.emit('floatingStart', { mode, sessionId }, owner)
    }, {
      sessionId,
      onNotReady: () => cancelVoiceImeSession('window-closed', sessionId),
    })
  }

  emitActiveState()
  return sessionId
}

/** 停止当前采集，进入 processing，保留 session 直到结果完成或取消。 */
export function requestVoiceImeStop(): void {
  const context = voiceImeState.sessionContext
  if (context) stopVoiceImeSession(context.sessionId)
}

/** 只允许当前 owner 或受管菜单栏窗口停止指定会话；快捷键入口没有 sender 时使用当前冻结会话。 */
function stopVoiceImeSession(
  sessionId: string,
  owner?: BrowserWindow,
  allowMenubarController = false,
): boolean {
  const context = voiceImeState.sessionContext
  if (!context || context.sessionId !== sessionId) return false
  if (
    owner
    && !voiceImeState.isSessionOwner(sessionId, owner)
    && (!allowMenubarController || !isManagedWindowOfType(owner, WindowType.MENUBAR))
  ) return false
  if (voiceImeState.currentPhase !== 'recording') return false

  if (!voiceImeState.setSessionPhase(context.sessionId, context.owner, 'processing')) return false
  emitActiveState()

  if (context.surface === 'embedded') {
    if (!context.owner.isDestroyed() && context.host) {
      voiceImeToRenderer.emit('embeddedStop', {
        host: context.host,
        mode: context.mode,
        sessionId: context.sessionId,
      }, context.owner)
    }
    return true
  }

  scheduleFloatingEvent(context.owner, () => {
    if (context.owner.isDestroyed()) return
    voiceImeToRenderer.emit('floatingStop', { mode: context.mode, sessionId: context.sessionId }, context.owner)
    voiceImeToRenderer.emit('status', { status: 'processing', sessionId: context.sessionId }, context.owner)
  }, {
    sessionId: context.sessionId,
    onNotReady: () => cancelVoiceImeSession('window-closed', context.sessionId),
  })

  return true
}

function beginVoiceImeTranscribing(sessionId: string, owner: BrowserWindow): boolean {
  const context = voiceImeState.sessionContext
  if (!context || (context.surface === 'floating' && context.owner !== owner)) return false
  if (!voiceImeState.setSessionPhase(sessionId, owner, 'processing')) return false

  emitActiveState()
  return true
}

function endVoiceImeSession(sessionId: string, owner: BrowserWindow): boolean {
  if (!voiceImeState.endSession(sessionId, owner)) return false

  stopVoiceImeEscapeWatcher()
  clearVoiceImeSessionTarget()
  emitActiveState()
  return true
}

/** 电源、Esc、宿主生命周期使用的会话取消入口。 */
export function cancelVoiceImeSession(
  reason: VoiceImeCancelReason,
  sessionId?: string,
): boolean {
  cancelPendingVoiceImeStart()
  const context = voiceImeState.sessionContext
  if (!context || (sessionId !== undefined && context.sessionId !== sessionId)) return false

  if (!context.owner.isDestroyed()) {
    if (context.surface === 'floating') {
      scheduleFloatingEvent(context.owner, () => {
        if (!context.owner.isDestroyed()) {
          voiceImeToRenderer.emit('cancel', {
            reason,
            sessionId: context.sessionId,
            host: context.host ?? undefined,
          }, context.owner)
        }
      }, {
        sessionId: context.sessionId,
        allowAfterSessionEnd: true,
      })
    }
    else {
      voiceImeToRenderer.emit('cancel', {
        reason,
        sessionId: context.sessionId,
        host: context.host ?? undefined,
      }, context.owner)
    }
  }

  const cancelled = voiceImeState.cancelSession(context.sessionId)
  if (!cancelled) return false

  stopVoiceImeEscapeWatcher()
  clearVoiceImeSessionTarget()
  emitActiveState()
  if (context.surface === 'floating' && shouldHideFloatingSession(reason)) windowManager.hide(WindowType.VOICE_IME)
  return true
}

function shouldHideFloatingSession(reason: VoiceImeCancelReason): boolean {
  return reason === 'suspend'
    || reason === 'resume'
    || reason === 'lock-screen'
    || reason === 'unlock-screen'
    || reason === 'host-unavailable'
    || reason === 'window-closed'
}

/** renderer 主动取消时只接受当前 owner + sessionId，并复用定向 cancel 事件清理采集。 */
function cancelOwnedVoiceImeSession(sessionId: string, owner: BrowserWindow): boolean {
  if (!voiceImeState.isSessionOwner(sessionId, owner)) return false
  return cancelVoiceImeSession('user', sessionId)
}

/** 只在窗口可用后发送浮层事件；start/stop 仍以 sessionId 做过期校验。 */
function scheduleFloatingEvent(
  window: BrowserWindow,
  send: () => void,
  options: FloatingEventScheduleOptions = {},
): void {
  const ready = windowManager.whenReady(WindowType.VOICE_IME)

  void ready
    .catch(() => false)
    .then((isReady) => {
      if (!isReady) {
        if (options.sessionId && voiceImeState.currentSessionId !== options.sessionId) return
        options.onNotReady?.()
        return
      }

      if (window.isDestroyed()) return
      if (!options.allowAfterSessionEnd) {
        if (
          options.sessionId
            ? voiceImeState.currentSessionId !== options.sessionId
            : voiceImeState.currentSessionId === null
        ) return
      }
      send()
    })
}

type FloatingEventScheduleOptions = {
  sessionId?: string
  allowAfterSessionEnd?: boolean
  onNotReady?: () => void
}

const voiceImeService = createIpcService<VoiceImeContract>(VOICE_IME_NAMESPACE, {
  mainHandle: {
    async setFocusContext(event, context) {
      const window = getWindowFromEvent(event)
      if (!window || !isFocusContext(context)) return
      setVoiceImeFocusContext(window, context)
    },

    async setEmbeddedHost(event, host, active, options: VoiceImeHostRegistrationOptions = {}) {
      const window = getWindowFromEvent(event)
      if (!window || typeof active !== 'boolean') return
      const registrationOptions = isHostRegistrationOptions(options)
        ? options
        : {}

      if (host === 'window') {
        registerVoiceImeWindowHost(window, active)
        const context = voiceImeState.sessionContext
        if (!active && context?.owner.webContents.id === window.webContents.id && context.host === host) {
          cancelVoiceImeSession('host-unavailable', context.sessionId)
        }
        return
      }
      if (!isValidHost(host)) return

      registerVoiceImeEmbeddedHost(window, host, active, registrationOptions)
      const context = voiceImeState.sessionContext
      if (!active && context?.owner.webContents.id === window.webContents.id && context.host === host) {
        cancelVoiceImeSession('host-unavailable', context.sessionId)
      }
    },

    async startClickMode(event): Promise<VoiceImeStartResponse> {
      if (!getWindowFromEvent(event)) return { success: false, blockedBy: 'aborted' }

      const result = await requestVoiceImeStart({ mode: 'click' })
      return result.started
        ? { success: true, sessionId: result.sessionId }
        : { success: false, blockedBy: result.blockedBy }
    },

    async stopSession(event, sessionId): Promise<boolean> {
      const window = getWindowFromEvent(event)
      if (!window || typeof sessionId !== 'string' || !sessionId) return false
      return stopVoiceImeSession(sessionId, window, true)
    },

    async cancelSession(event, sessionId): Promise<boolean> {
      const window = getWindowFromEvent(event)
      if (!window || typeof sessionId !== 'string' || !sessionId) return false
      return cancelOwnedVoiceImeSession(sessionId, window)
    },

    async beginTranscribing(event, sessionId): Promise<boolean> {
      const window = getWindowFromEvent(event)
      if (!window || typeof sessionId !== 'string' || !sessionId) return false
      return beginVoiceImeTranscribing(sessionId, window)
    },

    async endSession(event, sessionId): Promise<boolean> {
      const window = getWindowFromEvent(event)
      if (!window || typeof sessionId !== 'string' || !sessionId) return false
      return endVoiceImeSession(sessionId, window)
    },

    async releaseSession(event, payload) {
      const window = getWindowFromEvent(event)
      if (!window || !isCompletionPayload(payload)) return

      const context = voiceImeState.beginDelivery(payload.sessionId, window)
      if (!context) return

      let dispatchError: unknown
      try {
        if ('text' in payload.result) {
          await dispatchTranscription({ text: payload.result.text }, contextForSession(context))
        }
        else if (!window.isDestroyed()) {
          voiceImeToRenderer.emit('status', {
            error: payload.result.error,
            sessionId: payload.sessionId,
          }, window)
        }
      }
      catch (error) {
        dispatchError = error
      }
      finally {
        if (voiceImeState.completeDelivery(payload.sessionId)) {
          stopVoiceImeEscapeWatcher()
          clearVoiceImeSessionTarget()
          emitActiveState()
        }
      }

      if (dispatchError) throw dispatchError
    },

    async deliverTranscription(event, payload) {
      const window = getWindowFromEvent(event)
      if (!window || !isDeliverPayload(payload) || !payload.text.trim()) return

      await dispatchTranscription(payload, contextForSupplement())
    },

    async markRecordingStarted(event, sessionId, startedAt) {
      const window = getWindowFromEvent(event)
      if (!window || typeof sessionId !== 'string' || !Number.isFinite(startedAt)) return
      if (!voiceImeState.markSessionRecordingStarted(sessionId, window, startedAt)) return

      emitActiveState()
    },

    async getActiveState(event) {
      return getWindowFromEvent(event)
        ? voiceImeState.snapshot
        : {
          phase: 'idle',
          recordingStartedAt: null,
          surface: null,
          sessionId: null,
        }
    },
  },
})

/** 供服务索引保留的具名实例。 */
export { voiceImeService }

/** owner/宿主销毁时由状态层触发，确保主进程也回到空闲。 */
voiceImeState.onSessionInvalidated((context, reason) => {
  stopVoiceImeEscapeWatcher()
  cancelPendingVoiceImeStart()
  if (!context.owner.isDestroyed()) {
    voiceImeToRenderer.emit('cancel', {
      reason,
      sessionId: context.sessionId,
      host: context.host ?? undefined,
    }, context.owner)
  }
  clearVoiceImeSessionTarget()
  emitActiveState()
})

function isCompletionPayload(value: unknown): value is VoiceImeCompletionPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as { sessionId?: unknown; result?: unknown }
  if (typeof payload.sessionId !== 'string' || !payload.sessionId) return false
  if (!payload.result || typeof payload.result !== 'object') return false

  const result = payload.result as { text?: unknown; error?: unknown; duration?: unknown }
  if (typeof result.duration !== 'number' || !Number.isFinite(result.duration) || result.duration < 0) return false
  const hasText = typeof result.text === 'string'
  const hasError = typeof result.error === 'string'
  return hasText !== hasError
}

function isDeliverPayload(value: unknown): value is VoiceImeDeliverPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as { text?: unknown; sourceHost?: unknown }
  return typeof payload.text === 'string'
    && (payload.sourceHost === undefined || isValidSessionHost(payload.sourceHost))
}

export type RequestVoiceImeStartOptions = {
  /** 交互模式，缺省为 click。 */
  mode?: VoiceImeMode
  /** 已在异步门禁前取得的承载面快照。 */
  resolvedSurface?: ResolvedVoiceImeSurface
  /** 物理入口仍有效时返回 true。 */
  shouldContinue?: () => boolean
}

export type StartVoiceImeModeOptions = {
  /** 直接启动时使用的承载面快照。 */
  resolvedSurface?: ResolvedVoiceImeSurface
}

import type { VoiceImeActiveState, VoiceImeMode, VoiceImePhase, VoiceImeSessionHost, VoiceImeSurface } from '@shared'
import type { BrowserWindow } from 'electron'

/** Voice IME 相位的合法迁移；renderer 的迟到状态不能反向重开采集。 */
const ALLOWED_TRANSITIONS: Record<VoiceImePhase, readonly VoiceImePhase[]> = {
  idle: ['recording'],
  recording: ['processing', 'idle'],
  processing: ['idle'],
}

/** 一轮会话在主进程冻结的宿主上下文。 */
export type VoiceImeSessionContext = {
  sessionId: string
  owner: BrowserWindow
  surface: VoiceImeSurface
  host: VoiceImeSessionHost | null
  mode: VoiceImeMode
}

/** 异步投递期间使用的不可变上下文副本。 */
export type VoiceImeDeliveryContext = Readonly<VoiceImeSessionContext>

/** 会话因宿主失效而结束时通知 service 的原因。 */
export type VoiceImeSessionInvalidationReason = 'window-closed' | 'host-unavailable'

type SessionInvalidationListener = (
  context: VoiceImeDeliveryContext,
  reason: VoiceImeSessionInvalidationReason,
) => void

/**
 * 主进程唯一的 Voice IME 相位与会话槽位。
 *
 * 相位描述采集/处理阶段，会话槽位描述一轮仍然拥有结果投递权；二者分开保存，
 * 这样 renderer 已报 processing 或 idle 时，异步投递仍不会被另一轮抢占。
 */
export class VoiceImeStateManager {
  private phase: VoiceImePhase = 'idle'
  private recordingStartedAt: number | null = null
  private session: VoiceImeSessionContext | null = null
  private deliverySessionId: string | null = null
  private removeOwnerDestroyedListener: (() => void) | null = null
  private invalidationListeners = new Set<SessionInvalidationListener>()

  get currentPhase(): VoiceImePhase {
    return this.phase
  }

  get currentSurface(): VoiceImeSurface | null {
    return this.session?.surface ?? null
  }

  get currentSessionId(): string | null {
    return this.session?.sessionId ?? null
  }

  get hasSession(): boolean {
    return this.session !== null
  }

  get isActive(): boolean {
    return this.phase === 'recording' || this.phase === 'processing'
  }

  get isDelivering(): boolean {
    return this.deliverySessionId !== null
  }

  get snapshot(): VoiceImeActiveState {
    return {
      phase: this.phase,
      recordingStartedAt: this.recordingStartedAt,
      surface: this.session?.surface ?? null,
      sessionId: this.session?.sessionId ?? null,
    }
  }

  /** 当前冻结上下文；调用方得到的是同一轮的静态目标，而不是实时焦点。 */
  get sessionContext(): VoiceImeDeliveryContext | null {
    return this.session
  }

  /**
   * 将相位推进到目标状态。
   *
   * 同相位重复上报幂等，其他非法迁移返回 false 且不改状态。
   */
  setPhase(phase: VoiceImePhase): boolean {
    if (phase === this.phase) return true
    if (!ALLOWED_TRANSITIONS[this.phase].includes(phase)) return false

    this.phase = phase
    if (phase !== 'recording') this.recordingStartedAt = null
    return true
  }

  markRecordingStarted(startedAt: number): boolean {
    if (this.phase !== 'recording' || !Number.isFinite(startedAt)) return false

    this.recordingStartedAt = startedAt
    return true
  }

  /**
   * 原子认领一轮会话；同一时间只允许一个 owner。
   */
  openSession(context: VoiceImeSessionContext): boolean {
    if (this.session || context.owner.isDestroyed()) return false
    if (!context.sessionId || !context.owner.webContents || context.owner.webContents.isDestroyed()) return false

    this.session = { ...context }
    this.attachOwnerDestroyedListener(context)
    return true
  }

  /** 当前 sender 是否仍拥有指定会话。 */
  isSessionOwner(sessionId: string, owner: BrowserWindow): boolean {
    return this.session?.sessionId === sessionId
      && this.session.owner.webContents.id === owner.webContents.id
      && !owner.isDestroyed()
  }

  /** 只允许当前 owner + sessionId 更新相位。 */
  setSessionPhase(sessionId: string, owner: BrowserWindow, phase: VoiceImePhase): boolean {
    if (!this.isSessionOwner(sessionId, owner) || this.deliverySessionId) return false
    return this.setPhase(phase)
  }

  /** 只允许当前 owner + sessionId 登记采集起点。 */
  markSessionRecordingStarted(sessionId: string, owner: BrowserWindow, startedAt: number): boolean {
    if (!this.isSessionOwner(sessionId, owner) || this.phase !== 'recording') return false
    return this.markRecordingStarted(startedAt)
  }

  /**
   * 认领异步结果投递。
   *
   * 会话在 `completeDelivery` 前保持占用，返回值是冻结上下文副本；取消或窗口销毁后，
   * 迟到的完成回调无法再清理新会话。
   */
  beginDelivery(sessionId: string, owner: BrowserWindow): VoiceImeDeliveryContext | null {
    if (!this.isSessionOwner(sessionId, owner) || this.deliverySessionId) return null

    const session = this.session
    if (!session) return null

    this.deliverySessionId = sessionId
    return { ...session }
  }

  /** renderer 已结束嵌入会话但没有异步投递；只允许当前 owner + id 收尾。 */
  endSession(sessionId: string, owner: BrowserWindow): boolean {
    if (!this.isSessionOwner(sessionId, owner) || this.deliverySessionId) return false

    this.clearSession()
    this.phase = 'idle'
    this.recordingStartedAt = null
    return true
  }

  /** 完成当前投递并回到 idle；旧 sessionId 不会影响新会话。 */
  completeDelivery(sessionId: string): boolean {
    if (this.session?.sessionId !== sessionId || this.deliverySessionId !== sessionId) return false

    this.clearSession()
    this.phase = 'idle'
    this.recordingStartedAt = null
    return true
  }

  /**
   * 取消当前会话并立即释放槽位；投递 Promise 仍可在后台结束，但不能触碰后续会话。
   */
  cancelSession(sessionId?: string): VoiceImeDeliveryContext | null {
    if (!this.session || (sessionId !== undefined && this.session.sessionId !== sessionId)) return null

    const context = { ...this.session }
    this.clearSession()
    this.phase = 'idle'
    this.recordingStartedAt = null
    return context
  }

  /** 订阅 owner/宿主失效，返回幂等注销函数。 */
  onSessionInvalidated(listener: SessionInvalidationListener): () => void {
    this.invalidationListeners.add(listener)
    return () => {
      this.invalidationListeners.delete(listener)
    }
  }

  /** service 用于处理宿主注销；只对当前冻结宿主生效。 */
  invalidateForHost(host: VoiceImeSessionHost): VoiceImeDeliveryContext | null {
    if (!this.session || this.session.host !== host) return null

    return this.invalidateCurrentSession('host-unavailable')
  }

  /** 供 owner destroyed listener 和应用生命周期收尾使用。 */
  invalidateForWindow(owner: BrowserWindow): VoiceImeDeliveryContext | null {
    if (!this.session || this.session.owner.webContents.id !== owner.webContents.id) return null

    return this.invalidateCurrentSession('window-closed')
  }

  private invalidateCurrentSession(reason: VoiceImeSessionInvalidationReason): VoiceImeDeliveryContext | null {
    if (!this.session) return null

    const context = this.cancelSession()
    if (!context) return null

    for (const listener of this.invalidationListeners) listener(context, reason)
    return context
  }

  private attachOwnerDestroyedListener(context: VoiceImeSessionContext): void {
    const sender = context.owner.webContents
    const onDestroyed = (): void => {
      if (this.session?.sessionId === context.sessionId) this.invalidateCurrentSession('window-closed')
    }

    sender.once('destroyed', onDestroyed)
    this.removeOwnerDestroyedListener = () => {
      sender.removeListener('destroyed', onDestroyed)
      this.removeOwnerDestroyedListener = null
    }
  }

  private clearSession(): void {
    this.removeOwnerDestroyedListener?.()
    this.session = null
    this.deliverySessionId = null
  }
}

export const voiceImeState = new VoiceImeStateManager()

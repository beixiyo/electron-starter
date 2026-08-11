import type { NativeRecordingSource, RecordingPhase, RecordingSnapshot } from '@shared'
import { Clock } from '@jl-org/tool'
import { RECORDING_MAX_DURATION_MS, RECORDING_TICK_MS } from '@shared'

/**
 * 录音状态机（主进程单一真源）
 *
 * 手动 tap 与会议 ScreenCaptureKit 录音统一由此驱动：相位切换（pause/resume/stop/reset）
 * 经 onPhaseChange 转发给 audio-recorder 子进程；每秒 broadcast 快照给 renderer
 */
export class RecordingStateManager {
  private phase: RecordingPhase = 'idle'
  private elapsed = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null
  private clock = new Clock({ autoStart: false })
  private broadcastFn: ((snapshot: RecordingSnapshot) => void) | null = null
  private maxDurationReachedFn: (() => void) | null = null
  private phaseListeners = new Set<(prev: RecordingPhase, next: RecordingPhase) => void>()
  private _nativeSource: NativeRecordingSource | null = null
  /** 上次实际广播出去的快照摘要（null = 尚未广播过，首帧必发） */
  private lastSentDigest: string | null = null

  get snapshot(): RecordingSnapshot {
    return {
      phase: this.phase,
      elapsed: this.elapsed,
      nativeSource: this._nativeSource ?? undefined,
    }
  }

  get isBusy(): boolean {
    return this.phase === 'starting' || this.phase === 'recording' || this.phase === 'paused'
  }

  /** 仅 idle 可创建新 native session；stopped 仍处于原生混音/文件校验收尾窗口 */
  get canStart(): boolean {
    return this.phase === 'idle'
  }

  /** native 录音来源（null = 未在 native 录音），主进程 syncToRecorder 据此路由 native 命令 */
  get nativeSource(): NativeRecordingSource | null {
    return this._nativeSource
  }

  setBroadcast(fn: (snapshot: RecordingSnapshot) => void): void {
    this.broadcastFn = fn
  }

  setMaxDurationReached(fn: () => void): void {
    this.maxDurationReachedFn = fn
  }

  /** 手动录音（native tap 引擎，macOS 14.2+）：renderer 不驱动浏览器采集 */
  startManualNative(): RecordingSnapshot {
    return this.startNative('manual')
  }

  /** 会议录音（native SCK 引擎）：与手动录音共享互斥状态 */
  startMeetingNative(): RecordingSnapshot {
    return this.startNative('meeting')
  }

  start(): RecordingSnapshot {
    if (this.phase !== 'idle')
      return this.snapshot

    this._nativeSource = null
    this.enterRecording('idle')
    return this.snapshot
  }

  /**
   * Native helper 确认设备与 writer 已就绪后才开始计时
   *
   * @returns 是否接受了本次 ready；过期或重复回执返回 false
   */
  confirmNativeStarted(): boolean {
    if (this.phase !== 'starting' || !this._nativeSource)
      return false

    this.enterRecording('starting')
    return true
  }

  pause(): RecordingSnapshot {
    if (this.phase !== 'recording') {
      return this.snapshot
    }

    this.updateElapsed()
    this.phase = 'paused'
    this.clock.pause()
    this.stopTimer()
    this.stopMaxDurationTimer()
    this.broadcast()
    this.notifyPhase('recording', 'paused')
    return this.snapshot
  }

  resume(): RecordingSnapshot {
    if (this.phase !== 'paused') {
      return this.snapshot
    }

    this.clock.resume()
    this.phase = 'recording'
    this.startTimer()
    this.broadcast()
    this.notifyPhase('paused', 'recording')
    return this.snapshot
  }

  stop(): RecordingSnapshot {
    if (this.phase !== 'starting' && this.phase !== 'recording' && this.phase !== 'paused') {
      return this.snapshot
    }

    const prev = this.phase
    this.updateElapsed()
    this.phase = 'stopped'
    this.stopTimer()
    this.stopMaxDurationTimer()
    this.broadcast()
    this.notifyPhase(prev, 'stopped')
    return this.snapshot
  }

  private startNative(source: NativeRecordingSource): RecordingSnapshot {
    if (this.phase !== 'idle')
      return this.snapshot

    this._nativeSource = source
    this.elapsed = 0
    this.clock.reset()
    this.phase = 'starting'
    this.broadcast()
    this.notifyPhase('idle', 'starting')
    return this.snapshot
  }

  private enterRecording(prev: 'idle' | 'starting'): void {
    this.phase = 'recording'
    this.elapsed = 0
    this.clock.start()
    this.startTimer()
    this.broadcast()
    this.notifyPhase(prev, 'recording')
  }

  reset(): RecordingSnapshot {
    return this.resetState(true)
  }

  /** 原生录音已结束或异常退出：只清状态，不再向已终止的 helper 补发 stop */
  finishNative(): RecordingSnapshot {
    return this.resetState(false)
  }

  private resetState(notifyNative: boolean): RecordingSnapshot {
    const prev = this.phase
    this.phase = 'idle'
    this.elapsed = 0
    this.clock.reset()
    this.stopTimer()
    this.stopMaxDurationTimer()

    /**
     * 关键顺序：先在 nativeSource 仍有值时通知监听者（syncToRecorder 据此向原生子进程发 stop——
     * Discard 走 reset → idle，若先清 nativeSource 会被其 `!nativeSource` 早退拦掉），
     * 再清来源标记并广播最终快照
     */
    if (!notifyNative)
      this._nativeSource = null

    this.notifyPhase(prev, 'idle')

    this._nativeSource = null
    this.broadcast()
    return this.snapshot
  }

  private startTimer(): void {
    this.stopTimer()
    this.tick()
    this.scheduleTick()
    this.scheduleMaxDurationStop()
  }

  private stopTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private tick(): void {
    this.updateElapsed()
    if (this.clock.elapsedMS >= RECORDING_MAX_DURATION_MS) {
      this.stopForMaxDuration()
      return
    }

    this.broadcast()
  }

  private scheduleTick(): void {
    if (this.phase !== 'recording')
      return

    const elapsedMS = this.clock.elapsedMS
    const nextTickDelay = RECORDING_TICK_MS - (elapsedMS % RECORDING_TICK_MS) || RECORDING_TICK_MS

    this.timer = setTimeout(() => {
      this.timer = null
      this.tick()
      this.scheduleTick()
    }, nextTickDelay)
  }

  private scheduleMaxDurationStop(): void {
    this.stopMaxDurationTimer()

    if (this.phase !== 'recording')
      return

    const remainingMS = RECORDING_MAX_DURATION_MS - this.clock.elapsedMS
    if (remainingMS <= 0) {
      this.stopForMaxDuration()
      return
    }

    this.maxDurationTimer = setTimeout(() => {
      this.maxDurationTimer = null
      if (this.phase !== 'recording')
        return

      if (this.clock.elapsedMS >= RECORDING_MAX_DURATION_MS) {
        this.stopForMaxDuration()
        return
      }

      this.scheduleMaxDurationStop()
    }, remainingMS)
  }

  private stopMaxDurationTimer(): void {
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer)
      this.maxDurationTimer = null
    }
  }

  private updateElapsed(): void {
    const elapsedMS = Math.min(this.clock.elapsedMS, RECORDING_MAX_DURATION_MS)
    this.elapsed = Math.max(0, Math.floor(elapsedMS / 1000))
  }

  private stopForMaxDuration(): void {
    if (this.phase !== 'recording')
      return

    const prev = this.phase
    this.updateElapsed()
    this.phase = 'paused'
    this.clock.pause()
    this.stopTimer()
    this.stopMaxDurationTimer()
    this.broadcast()
    this.notifyPhase(prev, 'paused')
    this.maxDurationReachedFn?.()
  }

  onPhaseChange(callback: (prev: RecordingPhase, next: RecordingPhase) => void): () => void {
    this.phaseListeners.add(callback)
    return () => { this.phaseListeners.delete(callback) }
  }

  private notifyPhase(prev: RecordingPhase, next: RecordingPhase): void {
    if (prev !== next) {
      this.phaseListeners.forEach(fn => fn(prev, next))
    }
  }

  /**
   * 内容去重广播：快照内容与上次广播相同则跳过 emit，避免空转 IPC 击穿隐藏窗口的
   * backgroundThrottling。摘要必须覆盖 RecordingSnapshot 的全部字段（phase/elapsed/nativeSource），
   * 漏字段 = 该字段变化被吞；phase 在摘要内，暂停/恢复/停止跳变天然立即广播
   */
  private broadcast(): void {
    if (!this.broadcastFn)
      return

    const snap = this.snapshot
    const digest = `${snap.phase}|${snap.elapsed}|${snap.nativeSource ?? ''}`
    if (digest === this.lastSentDigest)
      return

    this.lastSentDigest = digest
    this.broadcastFn(snap)
  }
}

export const recordingState = new RecordingStateManager()

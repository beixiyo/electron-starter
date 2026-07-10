import type { NativeRecordingSource, RecordingPhase, RecordingSnapshot } from '@shared'
import { Clock } from '@jl-org/tool'
import { RECORDING_MAX_DURATION_MS, RECORDING_TICK_MS } from '@shared'

/**
 * 录音状态机（主进程单一真源）
 *
 * 手动 tap 与会议 ScreenCaptureKit 录音统一由此驱动：相位切换（pause/resume/stop/reset）
 * 经 onPhaseChange 转发给 audio-recorder 子进程；每秒 broadcast 快照给 renderer
 */
class RecordingStateManager {
  private phase: RecordingPhase = 'idle'
  private elapsed = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null
  private clock = new Clock({ autoStart: false })
  private broadcastFn: ((snapshot: RecordingSnapshot) => void) | null = null
  private maxDurationReachedFn: (() => void) | null = null
  private phaseListeners = new Set<(prev: RecordingPhase, next: RecordingPhase) => void>()
  private _nativeSource: NativeRecordingSource | null = null

  get snapshot(): RecordingSnapshot {
    return {
      phase: this.phase,
      elapsed: this.elapsed,
      nativeSource: this._nativeSource ?? undefined,
    }
  }

  get isBusy(): boolean {
    return this.phase === 'recording' || this.phase === 'paused'
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
    return this.startWithSource('manual')
  }

  /** 会议录音（native SCK 引擎）：与手动录音共享互斥状态 */
  startMeetingNative(): RecordingSnapshot {
    return this.startWithSource('meeting')
  }

  start(): RecordingSnapshot {
    return this.startWithSource(null)
  }

  /**
   * 统一启动入口：native 来源随本次启动显式设置
   * 普通 start() 必须清残留来源——stopped 后的下一次纯 mic 录音若带着
   * stale nativeSource，renderer 会误判为 native 模式而不驱动浏览器采集
   */
  private startWithSource(source: NativeRecordingSource | null): RecordingSnapshot {
    if (this.phase !== 'idle') {
      return this.snapshot
    }

    this._nativeSource = source

    const prev = this.phase
    console.log(`[rec-state] ${prev} → recording${source
      ? ` (native: ${source})`
      : ''}`)
    this.phase = 'recording'
    this.elapsed = 0
    this.clock.start()
    this.startTimer()
    this.broadcast()
    this.notifyPhase(prev, 'recording')
    return this.snapshot
  }

  pause(): RecordingSnapshot {
    if (this.phase !== 'recording') {
      return this.snapshot
    }

    console.log('[rec-state] recording → paused')
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

    console.log('[rec-state] paused → recording')
    this.clock.resume()
    this.phase = 'recording'
    this.startTimer()
    this.broadcast()
    this.notifyPhase('paused', 'recording')
    return this.snapshot
  }

  stop(): RecordingSnapshot {
    if (this.phase !== 'recording' && this.phase !== 'paused') {
      return this.snapshot
    }

    const prev = this.phase
    this.updateElapsed()
    console.log(`[rec-state] ${prev} → stopped (elapsed=${this.elapsed}s)`)
    this.phase = 'stopped'
    this.stopTimer()
    this.stopMaxDurationTimer()
    this.broadcast()
    this.notifyPhase(prev, 'stopped')
    return this.snapshot
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
    console.log('[rec-state] → idle (reset)')
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
    console.log(`[rec-state] recording reached max duration (${this.elapsed}s), pause and ask user`)
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

  private broadcast(): void {
    this.broadcastFn?.(this.snapshot)
  }
}

export const recordingState = new RecordingStateManager()

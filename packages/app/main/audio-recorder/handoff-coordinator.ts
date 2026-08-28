import type { RecorderEvents } from './protocol'

const STOP_HANDOFF_TIMEOUT_MS = 60_000
const RECYCLE_TERMINAL_TIMEOUT_MS = 2_000
const STOP_HANDOFF_TIMEOUT_DETAIL = `audio recorder did not finish stop handoff within ${STOP_HANDOFF_TIMEOUT_MS}ms; recovery assets were preserved`
const HANDOFF_INTERRUPTED_DETAIL = 'audio recorder helper exited before stop handoff produced a terminal result; recovery assets were preserved'
const RECYCLE_EXIT_UNCONFIRMED_DETAIL = 'audio recorder helper recycle did not confirm old process exit; recovery assets were preserved'

/**
 * 协调停止终态事件、helper 回收与超时恢复
 */
export class RecorderHandoffCoordinator {
  private readonly recycleGenerations = new Set<number>()
  private readonly handoffWatchdogs = new Map<number, ReturnType<typeof setTimeout>>()
  private readonly stopHandoffs = new Map<number, StopHandoff>()

  constructor(private readonly options: HandoffCoordinatorOptions) {}

  onHandoffComplete(generation: number | null): void {
    if (generation === null)
      return

    this.finishHandoffWatchdog(generation)
    this.recycleGenerations.delete(generation)
    const handoff = this.stopHandoffs.get(generation)
    if (!handoff)
      return

    if (handoff.timedOut) {
      this.emitHandoffFailure(generation, handoff, 'handoff_timeout', STOP_HANDOFF_TIMEOUT_DETAIL)
      return
    }

    this.options.logger.error('process.handoff-interrupted', 'audio recorder helper restarted before stop handoff produced a terminal result')
    this.emitHandoffFailure(generation, handoff, 'handoff_interrupted', HANDOFF_INTERRUPTED_DETAIL)
  }

  onHandoffStarted(generation: number): void {
    this.armHandoffWatchdog(generation, STOP_HANDOFF_TIMEOUT_MS)
  }

  registerStopHandoff(generation: number, expectedOutputPath: string): void {
    this.stopHandoffs.set(generation, {
      expectedOutputPath,
      timedOut: false,
    })
  }

  handleRecycleRequired(generation: number): void {
    const handoff = this.stopHandoffs.get(generation)
    if (
      this.options.getHandoffGeneration() === generation
      && handoff
      && !handoff.timedOut
    ) {
      this.recycleGenerations.add(generation)
      this.armHandoffWatchdog(generation, RECYCLE_TERMINAL_TIMEOUT_MS)
    }
  }

  emitTerminalAfterRequiredRecycle(
    generation: number | undefined,
    terminalPath: string,
    emit: () => void,
  ): void {
    if (generation === undefined) {
      this.options.logger.warn('protocol.invalid-terminal', 'ignored recorder terminal event without a handoff id')
      return
    }

    const handoff = this.stopHandoffs.get(generation)
    if (
      this.options.getHandoffGeneration() !== generation
      || !handoff
      || handoff.timedOut
      || handoff.expectedOutputPath !== terminalPath
    ) {
      this.options.logger.warn('process.stale-terminal-ignored', 'ignored stale recorder terminal event', {
        generation,
        activeGeneration: this.options.getHandoffGeneration(),
        expectedPath: handoff?.expectedOutputPath,
        terminalPath,
        timedOut: handoff?.timedOut ?? false,
      })
      return
    }

    this.stopHandoffs.delete(generation)
    const shouldRecycle = this.recycleGenerations.delete(generation)
    this.finishHandoffWatchdog(generation)
    if (!shouldRecycle) {
      this.options.finishHandoff(generation)
      emit()
      return
    }

    this.options.forceRestart(generation)
      .then(emit)
      .catch((error) => {
        this.options.logger.error('process.recycle-failed', 'audio recorder process recycle failed', error)
        this.options.emitError({
          code: 'handoff_timeout',
          detail: RECYCLE_EXIT_UNCONFIRMED_DETAIL,
          path: handoff.expectedOutputPath,
          terminal: true,
        })
      })
  }

  private armHandoffWatchdog(generation: number, timeoutMs: number): void {
    const existing = this.handoffWatchdogs.get(generation)
    if (existing)
      clearTimeout(existing)

    const watchdog = setTimeout(() => {
      const handoff = this.stopHandoffs.get(generation)
      if (
        this.options.getHandoffGeneration() !== generation
        || !handoff
        || handoff.timedOut
      ) {
        return
      }

      handoff.timedOut = true
      this.handoffWatchdogs.delete(generation)
      this.recycleGenerations.delete(generation)
      this.options.logger.error('process.handoff-timeout', 'audio recorder stop handoff timed out; force restarting helper')
      this.options.forceRestart(generation)
        .then(() => this.emitHandoffFailure(generation, handoff, 'handoff_timeout', STOP_HANDOFF_TIMEOUT_DETAIL))
        .catch((error) => {
          this.options.logger.error('process.recycle-failed', 'audio recorder process recycle failed', error)
          this.emitHandoffFailure(generation, handoff, 'handoff_timeout', STOP_HANDOFF_TIMEOUT_DETAIL)
        })
    }, timeoutMs)
    this.handoffWatchdogs.set(generation, watchdog)
  }

  /** helper 重建结束后发布且只发布一次业务终态，原始产物留给 recovery 扫描 */
  private emitHandoffFailure(
    generation: number,
    handoff: StopHandoff,
    code: 'handoff_timeout' | 'handoff_interrupted',
    detail: string,
  ): void {
    if (this.stopHandoffs.get(generation) !== handoff)
      return

    this.stopHandoffs.delete(generation)
    this.options.emitError({
      code,
      detail,
      path: handoff.expectedOutputPath,
      terminal: true,
    })
  }

  private finishHandoffWatchdog(generation: number): void {
    const watchdog = this.handoffWatchdogs.get(generation)
    if (watchdog)
      clearTimeout(watchdog)
    this.handoffWatchdogs.delete(generation)
  }
}

type HandoffCoordinatorOptions = {
  getHandoffGeneration: () => number | null
  finishHandoff: (generation: number) => void
  forceRestart: (generation: number) => Promise<void>
  emitError: (payload: RecorderEvents['error']) => void
  logger: HandoffLogger
}

type HandoffLogger = {
  error: (event: string, message: string, error?: unknown, context?: Record<string, unknown>) => void
  warn: (event: string, message: string, context?: Record<string, unknown>) => void
}

type StopHandoff = {
  /** 业务 session 开始时已固定的产物路径，不从后续 start 命令反推 */
  expectedOutputPath: string
  /** timeout 先封锁该代 terminal，避免迟到 stopped/error 与超时终态双触发 */
  timedOut: boolean
}

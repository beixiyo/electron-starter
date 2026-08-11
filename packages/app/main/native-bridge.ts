import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { EventBus } from '@jl-org/tool'
import { app } from 'electron'
import { createMainDiagnosticLogger } from './logging'

const log = createMainDiagnosticLogger('native.bridge')
const FORCE_RESTART_EXIT_TIMEOUT_MS = 1_000

export function getNativeBinaryPath(name: string): string {
  const resourcePath = path.join('native', getNativePlatformDir(), name)

  if (app.isPackaged)
    return path.join(process.resourcesPath, resourcePath)
  return path.join(__dirname, '../../resources', resourcePath)
}

function getNativePlatformDir(): string {
  if (process.platform === 'darwin')
    return 'mac'
  if (process.platform === 'win32')
    return 'windows'
  if (process.platform === 'linux')
    return 'linux'
  return process.platform
}

export class NativeBridge<T extends Record<string, any>> {
  private child: ChildProcess | null = null
  /**
   * 已结算的子进程。用 child 实例本身做代际身份：
   * exit / error 据此保证每代只处理一次；stop() 主动登记待杀的那代，
   * 令其滞后到达的退出事件不再被判成意外退出
   */
  private readonly settledChildren = new WeakSet<ChildProcess>()
  private restarting = false
  private restartPromise: Promise<void> | null = null
  private handoffCounter = 0
  private activeHandoffGeneration: number | null = null
  private readonly pendingWrites: PendingWrite[] = []
  readonly events = new EventBus<T>()

  constructor(private config: NativeBridgeConfig<T>) {}

  get running(): boolean {
    return this.child !== null
  }

  /** 子进程 pid（未启动时为 null），供会议检测排除自身录音 */
  get pid(): number | null {
    return this.child?.pid ?? null
  }

  get handoffGeneration(): number | null {
    return this.activeHandoffGeneration
  }

  start(): void {
    /** 与 startFnKeyListener 约定一致：非 macOS 静默跳过而非抛错，避免上层产生 unhandled rejection */
    if (process.platform !== 'darwin') {
      log.info('process.skipped', 'native helper start skipped on unsupported platform', {
        helper: this.config.name,
        platform: process.platform,
      })
      return
    }
    if (this.child !== null)
      return

    /** 局部捕获本次 spawn 的实例：exit/error 异步回调只清理自己这一代，避免 restart 后误清新 child */
    const child = spawn(getNativeBinaryPath(this.config.name), this.config.args ?? [], {
      stdio: [
        this.config.writable
          ? 'pipe'
          : 'ignore',
        'pipe',
        this.config.logStderr
          ? 'pipe'
          : 'ignore',
      ],
    })

    this.child = child

    child.stdout?.setEncoding('utf8')
    log.debug('process.started', 'native helper process started', {
      helper: this.config.name,
      pid: child.pid,
    })

    let buffer = ''
    child.stdout?.on('data', (data: string) => {
      if (this.settledChildren.has(child))
        return
      buffer += data
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed)
          this.config.parseLine(trimmed, this.events)
      }
    })

    if (this.config.logStderr) {
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (data: string) => {
        for (const line of data.split('\n')) {
          const trimmed = line.trim()
          if (trimmed) {
            if (this.config.onStderrLine)
              this.config.onStderrLine(trimmed)
            else
              console.log(`[${this.config.name}] ${trimmed}`)
          }
        }
      })
    }

    child.on('exit', (code, signal) => {
      if (this.settledChildren.has(child))
        return

      this.settledChildren.add(child)
      if (this.child === child)
        this.child = null
      if (this.restarting) {
        void this.forceRestart(this.activeHandoffGeneration ?? undefined)
        return
      }
      const unexpected = signal !== 'SIGTERM' && signal !== 'SIGINT'
      if (unexpected) {
        log.warn('process.unexpected-exit', 'native helper exited unexpectedly', {
          helper: this.config.name,
          exitCode: code,
          signal,
        })
        this.config.onUnexpectedExit?.(code, signal)
      }
    })

    child.on('error', (error) => {
      if (this.settledChildren.has(child))
        return

      this.settledChildren.add(child)
      log.error('process.start.failed', 'native helper failed to start', error, { helper: this.config.name })
      if (this.child === child)
        this.child = null
      if (this.restarting) {
        void this.forceRestart(this.activeHandoffGeneration ?? undefined)
        return
      }
      this.config.onUnexpectedExit?.(null, null)
    })
  }

  /**
   * 向当前 helper 写入一条命令
   *
   * @returns 命令已写入或已在重启屏障中排队时返回 true；helper 不可用时返回 false
   */
  send(data: string): boolean {
    if (this.restarting) {
      this.pendingWrites.push({ kind: 'command', data })
      return true
    }
    if (!this.child?.stdin?.writable)
      return false
    this.child.stdin.write(`${data}\n`)
    return true
  }

  /**
   * 将 stop 写入当前 helper 后立即建立 handoff barrier。同一 JS turn 内先写 stop 再冻结，
   * 后续 start/update 不会进入旧 stdin；terminal 决定原进程继续使用还是整体重建
   */
  sendAndBeginHandoff(makeData: (generation: number) => string): number {
    const generation = ++this.handoffCounter
    const data = makeData(generation)
    if (this.restarting) {
      this.pendingWrites.push({ kind: 'handoff', data, generation })
      return generation
    }
    if (!this.child?.stdin)
      this.start()
    if (this.child?.stdin)
      this.child.stdin.write(`${data}\n`)
    this.restarting = true
    this.activeHandoffGeneration = generation
    this.config.onHandoffStarted?.(generation)
    return generation
  }

  /** terminal 明确无需 recycle 时解除 barrier，并向当前 helper 重放缓存命令 */
  finishHandoff(generation: number): void {
    if (this.activeHandoffGeneration !== generation)
      return
    this.finishRestart(generation)
  }

  stop(): void {
    if (this.child === null)
      return

    /**
     * 先登记再 kill：exit 事件异步到达，届时 restart 可能已 spawn 新进程
     * 不登记则老进程的退出会被判成意外退出——helper 若自行捕获 SIGTERM 后 exit(0)，
     * signal 为 null 恰好绕过 SIGTERM / SIGINT 判断，从而在健康的新一代上
     * 触发一次多余的 onUnexpectedExit（全量快捷键重注册）
     */
    this.settledChildren.add(this.child)

    this.child.kill()
    log.debug('process.stopped', 'native helper process stopped', { helper: this.config.name })
    this.child = null
  }

  restart(): void {
    this.stop()
    this.start()
  }

  /**
   * 仅用于 helper 已完成业务收尾、但内部原生资源可能卡在不可取消同步调用的场景
   *
   * SIGTERM 会进入 helper 自己的优雅收尾链，若该链正被系统调用卡住就无法退出；
   * 此处明确用 SIGKILL 回收旧进程，并立即创建干净的新一代
   */
  forceRestart(expectedGeneration?: number): Promise<void> {
    if (
      expectedGeneration !== undefined
      && this.activeHandoffGeneration !== expectedGeneration
    ) {
      return Promise.resolve()
    }
    if (this.restartPromise)
      return this.restartPromise
    this.restarting = true
    const completedGeneration = this.activeHandoffGeneration
    this.restartPromise = this.performForceRestart(completedGeneration)
      .finally(() => {
        this.restartPromise = null
      })
    return this.restartPromise
  }

  private async performForceRestart(completedGeneration: number | null): Promise<void> {
    const child = this.child
    if (child === null) {
      this.start()
      this.finishRestart(completedGeneration)
      return
    }

    this.settledChildren.add(child)
    this.child = null
    await new Promise<void>((resolve) => {
      let restarted = false
      let watchdog: ReturnType<typeof setTimeout> | null = null

      const restartAfterExit = (reason: 'exit' | 'watchdog' | 'kill-failed') => {
        if (restarted)
          return
        restarted = true
        child.off('exit', onExit)
        if (watchdog !== null) {
          clearTimeout(watchdog)
          watchdog = null
        }
        if (reason !== 'exit') {
          log.warn('process.force-restart-watchdog', 'native helper exit event was not observed; starting a new generation', {
            helper: this.config.name,
            pid: child.pid,
            reason,
          })
        }
        this.start()
        this.finishRestart(completedGeneration)
        resolve()
      }
      const onExit = () => restartAfterExit('exit')
      child.once('exit', onExit)
      watchdog = setTimeout(() => restartAfterExit('watchdog'), FORCE_RESTART_EXIT_TIMEOUT_MS)
      watchdog.unref?.()

      const signaled = child.kill('SIGKILL')
      log.debug('process.force-restarted', 'native helper process force restarted after completed handoff', {
        helper: this.config.name,
        pid: child.pid,
        signaled,
      })
      if (!signaled) {
        restartAfterExit('kill-failed')
      }
    })
  }

  private finishRestart(completedGeneration: number | null): void {
    if (
      completedGeneration !== null
      && this.activeHandoffGeneration !== completedGeneration
    ) {
      return
    }
    this.restarting = false
    this.activeHandoffGeneration = null

    while (this.pendingWrites.length > 0) {
      const write = this.pendingWrites.shift()!
      if (this.child?.stdin)
        this.child.stdin.write(`${write.data}\n`)
      if (write.kind === 'handoff') {
        this.restarting = true
        this.activeHandoffGeneration = write.generation
        this.config.onHandoffStarted?.(write.generation)
        break
      }
    }
    this.config.onHandoffComplete?.(completedGeneration)
  }
}

type NativeBridgeConfig<T extends Record<string, any>> = {
  name: string
  args?: string[]
  writable?: boolean
  logStderr?: boolean
  /** stderr 逐行回调（logStderr 开启时生效），供产品接入自己的持久化诊断日志 */
  onStderrLine?: (line: string) => void
  onUnexpectedExit?: (code: number | null, signal: NodeJS.Signals | null) => void
  /** handoff 通过复用或重建 helper 完成，供上层结算同一代 watchdog */
  onHandoffComplete?: (generation: number | null) => void
  /** stop 已真正写入 helper 并建立 barrier，此时才开始计算该代 terminal timeout */
  onHandoffStarted?: (generation: number) => void
  parseLine: (line: string, bus: EventBus<T>) => void
}

type PendingWrite
  = | { kind: 'command', data: string }
    | { kind: 'handoff', data: string, generation: number }

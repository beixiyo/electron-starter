import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { EventBus } from '@jl-org/tool'
import { app } from 'electron'
import { createMainDiagnosticLogger } from './logging'

const log = createMainDiagnosticLogger('native.bridge')

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
  readonly events = new EventBus<T>()

  constructor(private config: NativeBridgeConfig<T>) {}

  get running(): boolean {
    return this.child !== null
  }

  /** 子进程 pid（未启动时为 null），供会议检测排除自身录音 */
  get pid(): number | null {
    return this.child?.pid ?? null
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
    log.info('process.started', 'native helper process started', {
      helper: this.config.name,
      pid: child.pid,
    })

    let buffer = ''
    child.stdout?.on('data', (data: string) => {
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
            console.log(`[${this.config.name}] ${trimmed}`)
            this.config.onStderrLine?.(trimmed)
          }
        }
      })
    }

    child.on('exit', (code, signal) => {
      if (this.settledChildren.has(child))
        return

      this.settledChildren.add(child)
      const unexpected = signal !== 'SIGTERM' && signal !== 'SIGINT'
      if (this.child === child)
        this.child = null
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
      this.config.onUnexpectedExit?.(null, null)
    })
  }

  send(data: string): void {
    if (!this.child?.stdin)
      return
    this.child.stdin.write(`${data}\n`)
  }

  stop(): void {
    if (this.child === null)
      return

    /**
     * 先登记再 kill：exit 事件异步到达，届时 restart 可能已 spawn 新进程。
     * 不登记则老进程的退出会被判成意外退出——helper 若自行捕获 SIGTERM 后 exit(0)，
     * signal 为 null 恰好绕过 SIGTERM / SIGINT 判断，从而在健康的新一代上
     * 触发一次多余的 onUnexpectedExit（全量快捷键重注册）
     */
    this.settledChildren.add(this.child)

    this.child.kill()
    log.info('process.stopped', 'native helper process stopped', { helper: this.config.name })
    this.child = null
  }

  restart(): void {
    this.stop()
    this.start()
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
  parseLine: (line: string, bus: EventBus<T>) => void
}

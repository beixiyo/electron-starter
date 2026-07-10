import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { EventBus } from '@jl-org/tool'
import { app } from 'electron'

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
      console.warn(`[${this.config.name}] macOS only, start() skipped`)
      return
    }
    if (this.child !== null)
      return

    this.child = spawn(getNativeBinaryPath(this.config.name), this.config.args ?? [], {
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

    this.child.stdout?.setEncoding('utf8')

    let buffer = ''
    this.child.stdout?.on('data', (data: string) => {
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
      this.child.stderr?.setEncoding('utf8')
      this.child.stderr?.on('data', (data: string) => {
        for (const line of data.split('\n')) {
          const trimmed = line.trim()
          if (trimmed)
            console.log(`[${this.config.name}] ${trimmed}`)
        }
      })
    }

    let childClosed = false

    this.child.on('exit', (code, signal) => {
      if (childClosed)
        return

      childClosed = true
      const unexpected = signal !== 'SIGTERM' && signal !== 'SIGINT'
      this.child = null
      if (unexpected) {
        console.warn(`[${this.config.name}] unexpected exit: code=${code} signal=${signal}`)
        this.config.onUnexpectedExit?.(code, signal)
      }
    })

    this.child.on('error', (error) => {
      if (childClosed)
        return

      childClosed = true
      console.warn(`[${this.config.name}] failed to start:`, error)
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
    this.child.kill()
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
  onUnexpectedExit?: (code: number | null, signal: NodeJS.Signals | null) => void
  parseLine: (line: string, bus: EventBus<T>) => void
}

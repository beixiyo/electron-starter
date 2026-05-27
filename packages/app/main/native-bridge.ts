import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { EventBus } from '@jl-org/tool'
import { app } from 'electron'

export function getNativeBinaryPath(name: string): string {
  if (app.isPackaged)
    return path.join(process.resourcesPath, name)
  return path.join(__dirname, `../../resources/${name}`)
}

export class NativeBridge<T extends Record<string, any>> {
  private child: ChildProcess | null = null
  readonly events = new EventBus<T>()

  constructor(private config: NativeBridgeConfig<T>) {}

  get running(): boolean {
    return this.child !== null
  }

  start(): void {
    if (process.platform !== 'darwin')
      throw new Error(`[${this.config.name}] macOS only`)
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

    this.child.on('exit', (code, signal) => {
      if (signal !== 'SIGTERM' && signal !== 'SIGINT')
        console.warn(`[${this.config.name}] unexpected exit: code=${code} signal=${signal}`)
      this.child = null
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
}

type NativeBridgeConfig<T extends Record<string, any>> = {
  name: string
  args?: string[]
  writable?: boolean
  logStderr?: boolean
  parseLine: (line: string, bus: EventBus<T>) => void
}

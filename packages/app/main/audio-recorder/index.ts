import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { formatDate } from '@jl-org/tool'
import { app } from 'electron'
import { NativeBridge } from '../native-bridge'

const bridge = new NativeBridge<RecorderEvents>({
  name: 'audio-recorder',
  writable: true,
  logStderr: true,
  parseLine(line, bus) {
    try {
      const msg: RecorderMessage = JSON.parse(line)
      if ('error' in msg) {
        console.warn(`[audio-recorder] error: ${msg.error}`)
        bus.emit('error', msg.error)
      }
      else if (msg.status === 'recording') {
        console.log(`[audio-recorder] recording → ${msg.path}`)
        bus.emit('recording', { path: msg.path })
      }
      else if (msg.status === 'paused') {
        console.log(`[audio-recorder] paused`)
        bus.emit('paused', { path: msg.path })
      }
      else if (msg.status === 'mixing') {
        console.log(`[audio-recorder] mixing tracks...`)
        bus.emit('mixing', { path: msg.path })
      }
      else if (msg.status === 'stopped') {
        console.log(`[audio-recorder] stopped (${msg.duration ?? 0}s) → ${msg.path}`)
        bus.emit('stopped', { path: msg.path, duration: msg.duration ?? 0 })
      }
    }
    catch {
      console.warn('[audio-recorder] parse error:', line)
    }
  },
})

export function startRecorder(): void {
  console.log('[audio-recorder] spawning process...')
  bridge.start()
  console.log(`[audio-recorder] process running: ${bridge.running}`)
}

export function stopRecorder(): void {
  bridge.stop()
}

/** 录制子进程 pid（未启动时为 null），供会议检测排除自身录音误报 */
export function getRecorderPid(): number | null {
  return bridge.pid
}

export function startRecording(outputPath?: string): void {
  const filePath = outputPath ?? defaultOutputPath()
  mkdirSync(path.dirname(filePath), { recursive: true })
  console.log(`[audio-recorder] sending start → ${filePath}`)
  bridge.send(JSON.stringify({ action: 'start', outputPath: filePath }))
}

export function pauseRecording(): void {
  bridge.send(JSON.stringify({ action: 'pause' }))
}

export function resumeRecording(): void {
  bridge.send(JSON.stringify({ action: 'resume' }))
}

export function stopRecording(): void {
  bridge.send(JSON.stringify({ action: 'stop' }))
}

export function onRecorderEvent<K extends keyof RecorderEvents>(
  event: K,
  listener: (data: RecorderEvents[K]) => void,
): () => void {
  return bridge.events.on(event, listener)
}

function defaultOutputPath(): string {
  const ts = formatDate('yyyy-MM-dd HH-mm-ss')
  const dir = path.join(app.getPath('temp'), 'meeting-recordings')
  return path.join(dir, `会议录制 ${ts}.m4a`)
}

type RecorderEvents = {
  recording: { path: string }
  paused: { path: string }
  mixing: { path: string }
  stopped: { path: string, duration: number }
  error: string
}

type RecorderMessage
  = | { status: 'recording', path: string, duration?: never }
    | { status: 'paused', path: string, duration?: never }
    | { status: 'mixing', path: string, duration?: never }
    | { status: 'stopped', path: string, duration?: number }
    | { error: string, status?: never }

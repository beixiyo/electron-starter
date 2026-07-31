import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { formatDate } from '@jl-org/tool'
import { createMainDiagnosticLogger } from '@main/logging'
import { app } from 'electron'
import { NativeBridge } from '../native-bridge'

const nativeLog = createMainDiagnosticLogger('native.recorder')
const recycleGenerations = new Set<number>()
const handoffWatchdogs = new Map<number, ReturnType<typeof setTimeout>>()
const STOP_HANDOFF_TIMEOUT_MS = 60_000
const RECYCLE_TERMINAL_TIMEOUT_MS = 2_000

const bridge = new NativeBridge<RecorderEvents>({
  name: 'audio-recorder',
  writable: true,
  logStderr: true,
  onStderrLine: line => nativeLog.info('native.stderr', line),
  onUnexpectedExit: (code, signal) => {
    bridge.events.emit('exited', { code, signal })
  },
  onHandoffComplete: (generation) => {
    if (generation !== null) {
      finishHandoffWatchdog(generation)
      recycleGenerations.delete(generation)
    }
  },
  onHandoffStarted: (generation) => {
    armHandoffWatchdog(generation, STOP_HANDOFF_TIMEOUT_MS)
  },
  parseLine(line, bus) {
    try {
      const msg: RecorderMessage = JSON.parse(line)
      if ('error' in msg) {
        const emitError = () => {
          console.warn(`[audio-recorder] error: ${msg.error}${msg.detail
            ? ` (${msg.detail})`
            : ''}`)
          bus.emit('error', {
            code: msg.error,
            detail: msg.detail,
            path: msg.path,
            terminal: msg.terminal === true,
          })
        }
        if (msg.terminal === true)
          emitTerminalAfterRequiredRecycle(msg.handoffId, emitError)
        else
          emitError()
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
        const emitStopped = () => {
          console.log(`[audio-recorder] stopped (${msg.duration ?? 0}s) → ${msg.path}`)
          bus.emit('stopped', { path: msg.path, duration: msg.duration ?? 0 })
        }
        emitTerminalAfterRequiredRecycle(msg.handoffId, emitStopped)
      }
      else if (msg.status === 'recycle_required') {
        if (bridge.handoffGeneration === msg.handoffId) {
          recycleGenerations.add(msg.handoffId)
          armHandoffWatchdog(msg.handoffId, RECYCLE_TERMINAL_TIMEOUT_MS)
        }
        nativeLog.warn('process.recycle-required', 'audio recorder requested process recycle after recording stop')
      }
      else if (msg.status === 'mic_degraded') {
        /** 非致命：麦克风掉线且未能自愈，录音继续保留系统音轨 */
        console.warn(`[audio-recorder] mic degraded${msg.detail
          ? ` (${msg.detail})`
          : ''}`)
        bus.emit('mic_degraded', { detail: msg.detail })
      }
    }
    catch {
      console.warn('[audio-recorder] parse error:', line)
    }
  },
})

/**
 * recycle 是 terminal handoff 的一部分：先重建 helper，再发布 stopped/error
 * 因此业务层在 terminal 回调里开始下一场录音时，命令一定发给新 helper；重启窗口内
 * 其它来源提前发来的命令由 NativeBridge 暂存并在新进程 spawn 后按序重放
 */
function emitTerminalAfterRequiredRecycle(generation: number | undefined, emit: () => void): void {
  if (generation === undefined || bridge.handoffGeneration !== generation) {
    emit()
    return
  }

  const shouldRecycle = recycleGenerations.delete(generation)
  finishHandoffWatchdog(generation)
  if (!shouldRecycle) {
    bridge.finishHandoff(generation)
    emit()
    return
  }

  bridge.forceRestart(generation)
    .then(emit)
    .catch((error) => {
      nativeLog.error('process.recycle-failed', 'audio recorder process recycle failed', error)
      emit()
    })
}

function armHandoffWatchdog(generation: number, timeoutMs: number): void {
  const existing = handoffWatchdogs.get(generation)
  if (existing)
    clearTimeout(existing)
  const watchdog = setTimeout(() => {
    if (bridge.handoffGeneration !== generation)
      return
    handoffWatchdogs.delete(generation)
    recycleGenerations.delete(generation)
    nativeLog.error('process.handoff-timeout', 'audio recorder stop handoff timed out; force restarting helper')
    bridge.forceRestart(generation)
      .catch(error => nativeLog.error('process.recycle-failed', 'audio recorder process recycle failed', error))
  }, timeoutMs)
  handoffWatchdogs.set(generation, watchdog)
}

function finishHandoffWatchdog(generation: number): void {
  const watchdog = handoffWatchdogs.get(generation)
  if (watchdog)
    clearTimeout(watchdog)
  handoffWatchdogs.delete(generation)
}

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

export function startRecording(outputPath?: string, options?: StartRecordingOptions): void {
  const filePath = outputPath ?? defaultOutputPath()
  mkdirSync(path.dirname(filePath), { recursive: true })
  console.log(`[audio-recorder] sending start → ${filePath}${options?.engine
    ? ` (engine=${options.engine}, pids=[${options.pids?.join(',') ?? ''}])`
    : ''}`)
  bridge.send(JSON.stringify({ action: 'start', outputPath: filePath, ...options }))
}

/** tap 录音中热挂/卸音源（mic + 系统音轨）或变更混入进程集合（仅 engine='tap' 的录音有效，SCK 链路忽略） */
export function updateRecording(options: UpdateRecordingOptions): void {
  console.log(`[audio-recorder] sending update → mic=${options.micEnabled}, tap=${options.tapEnabled}, pids=[${options.pids.join(',')}]`)
  bridge.send(JSON.stringify({ action: 'update', ...options }))
}

export function pauseRecording(): void {
  bridge.send(JSON.stringify({ action: 'pause' }))
}

export function resumeRecording(): void {
  bridge.send(JSON.stringify({ action: 'resume' }))
}

export function stopRecording(): void {
  bridge.sendAndBeginHandoff(handoffId => JSON.stringify({ action: 'stop', handoffId }))
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

export type StartRecordingOptions = {
  /** 录音引擎：缺省 = ScreenCaptureKit 全系统音频（会议链路）；tap = Core Audio tap 引擎（手动录音，macOS 14.2+） */
  engine?: 'tap'
  /**
   * tap 引擎：是否随启动挂载系统音轨；false = 纯 mic 开录（系统音轨预建空轨，
   * 录音中可经 updateRecording 热挂）
   *
   * @default true
   */
  tapEnabled?: boolean
  /** tap 引擎：仅混入这些进程的音频；空数组 / 缺省 = 全系统混音 */
  pids?: number[]
  /** tap 引擎全系统模式：排除的进程（传自身进程族防自录，include 模式忽略） */
  excludePids?: number[]
  /**
   * tap 引擎：是否随启动采集麦克风（mic 轨恒预建，此项决定初始是否进样；录音中可经 updateRecording 热挂/卸）
   *
   * @default true
   */
  mic?: boolean
}

/** tap 录音中热挂/卸的完整音源状态（renderer 每次变更下发全量，Swift 据此挂/卸 mic 与 tap） */
export type UpdateRecordingOptions = {
  /** 麦克风是否采集 */
  micEnabled: boolean
  /** 系统音轨（tap）是否挂载 */
  tapEnabled: boolean
  /** tap 仅混入这些进程；空 = 全系统混音 */
  pids: number[]
  /** tap 全系统模式排除的进程（自身进程族） */
  excludePids: number[]
}

type RecorderEvents = {
  recording: { path: string }
  paused: { path: string }
  mixing: { path: string }
  stopped: { path: string, duration: number }
  error: { code: string, detail?: string, path?: string, terminal: boolean }
  mic_degraded: { detail?: string }
  exited: { code: number | null, signal: NodeJS.Signals | null }
}

type RecorderMessage
  = | { status: 'recording', path: string, duration?: never, detail?: never }
    | { status: 'paused', path: string, duration?: never, detail?: never }
    | { status: 'mixing', path: string, duration?: never, detail?: never }
    | { status: 'stopped', path: string, duration?: number, handoffId?: number, detail?: never }
    | { status: 'mic_degraded', detail?: string, path?: never, duration?: never }
    | { status: 'recycle_required', handoffId: number, detail?: string, path?: never, duration?: never }
    | { error: string, detail?: string, terminal?: false, path?: string, status?: never }
    | { error: string, detail?: string, terminal: true, path: string, handoffId?: number, status?: never }

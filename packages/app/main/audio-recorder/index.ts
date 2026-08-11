import type { RecorderEvents } from './protocol'
import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { formatDate } from '@jl-org/tool'
import { createMainDiagnosticLogger } from '@main/logging'
import { app } from 'electron'
import { getNativeBinaryPath, NativeBridge } from '../native-bridge'
import { RecorderHandoffCoordinator } from './handoff-coordinator'
import { parseRecorderMessage } from './protocol'

const nativeLog = createMainDiagnosticLogger('native.recorder')
let handoffCoordinator: RecorderHandoffCoordinator

const bridge = new NativeBridge<RecorderEvents>({
  name: 'audio-recorder',
  writable: true,
  logStderr: true,
  onStderrLine: line => nativeLog.debug('native.stderr', line),
  onUnexpectedExit: (code, signal) => {
    bridge.events.emit('exited', { code, signal })
  },
  onHandoffComplete: generation => handoffCoordinator.onHandoffComplete(generation),
  onHandoffStarted: generation => handoffCoordinator.onHandoffStarted(generation),
  parseLine(line, bus) {
    try {
      const msg = parseRecorderMessage(line)
      if ('error' in msg) {
        const emitError = () => {
          bus.emit('error', {
            code: msg.error,
            detail: msg.detail,
            path: msg.path,
            terminal: msg.terminal === true,
          })
        }
        if (
          msg.terminal === true
          && (typeof msg.path !== 'string' || msg.path.length === 0)
        ) {
          nativeLog.warn('protocol.invalid-terminal', 'ignored recorder terminal error without an output path', {
            code: msg.error,
            handoffId: msg.handoffId,
          })
        }
        else if (msg.terminal === true) {
          handoffCoordinator.emitTerminalAfterRequiredRecycle(msg.handoffId, msg.path, emitError)
        }
        else {
          emitError()
        }
      }
      else if (msg.status === 'recording') {
        bus.emit('recording', { path: msg.path })
      }
      else if (msg.status === 'paused') {
        bus.emit('paused', { path: msg.path })
      }
      else if (msg.status === 'mixing') {
        bus.emit('mixing', { path: msg.path })
      }
      else if (msg.status === 'stopped') {
        const emitStopped = () => {
          void validateRecorderOutput(msg.path).then((valid) => {
            if (valid) {
              bus.emit('stopped', { path: msg.path, duration: msg.duration ?? 0 })
              return
            }

            const detail = 'final audio failed independent decode validation; recovery assets were preserved'
            nativeLog.error('output.validation-failed', detail, undefined, { path: msg.path })
            bus.emit('error', {
              code: 'writer_failed',
              detail,
              path: msg.path,
              terminal: true,
            })
          })
        }
        handoffCoordinator.emitTerminalAfterRequiredRecycle(msg.handoffId, msg.path, emitStopped)
      }
      else if (msg.status === 'recycle_required') {
        handoffCoordinator.handleRecycleRequired(msg.handoffId)
        nativeLog.debug('process.recycle-required', 'audio recorder requested process recycle after recording stop')
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

handoffCoordinator = new RecorderHandoffCoordinator({
  getHandoffGeneration: () => bridge.handoffGeneration,
  finishHandoff: generation => bridge.finishHandoff(generation),
  forceRestart: generation => bridge.forceRestart(generation),
  emitError: payload => bridge.events.emit('error', payload),
  logger: nativeLog,
})

/**
 * 用全新 helper 进程解码最终产物，避免信任刚完成 writer/mix 的进程内缓存状态
 */
function validateRecorderOutput(outputPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    execFile(
      getNativeBinaryPath('audio-recorder'),
      ['--validate-audio', outputPath],
      { timeout: 30_000 },
      error => resolve(error === null),
    )
  })
}

export function startRecorder(): void {
  bridge.start()
}

export function stopRecorder(): void {
  bridge.stop()
}

/** native start/stop 协议失去终止回执时，回收当前 helper 并等待新一代启动 */
export function forceRestartRecorder(): Promise<void> {
  return bridge.forceRestart()
}

/** 录制子进程 pid（未启动时为 null），供会议检测排除自身录音误报 */
export function getRecorderPid(): number | null {
  return bridge.pid
}

export function startRecording(outputPath?: string, options?: StartRecordingOptions): boolean {
  const filePath = outputPath ?? defaultOutputPath()
  mkdirSync(path.dirname(filePath), { recursive: true })
  /** helper 异常退出后允许下一次 start 自愈；start() 对存活进程幂等 */
  if (!bridge.running)
    bridge.start()
  return bridge.send(JSON.stringify({ action: 'start', outputPath: filePath, ...options }))
}

/** tap 录音中热挂/卸音源（mic + 系统音轨）或变更混入进程集合（仅 engine='tap' 的录音有效，SCK 链路忽略） */
export function updateRecording(options: UpdateRecordingOptions): void {
  bridge.send(JSON.stringify({ action: 'update', ...options }))
}

export function pauseRecording(): void {
  bridge.send(JSON.stringify({ action: 'pause' }))
}

export function resumeRecording(): void {
  bridge.send(JSON.stringify({ action: 'resume' }))
}

/**
 * 停止当前录音并建立 terminal handoff
 *
 * expectedOutputPath 是本次业务 session 的身份；watchdog 超时时依它路由终态，
 * 不会从后续 start 命令反推路径
 */
export function stopRecording(expectedOutputPath: string): void {
  bridge.sendAndBeginHandoff((handoffId) => {
    handoffCoordinator.registerStopHandoff(handoffId, expectedOutputPath)
    return JSON.stringify({ action: 'stop', handoffId })
  })
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

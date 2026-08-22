import type { MicCaptureStrategy, MicVoiceProcessingOutcome, RecorderEvents } from './protocol'
import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { formatDate } from '@jl-org/tool'
import { createMainDiagnosticLogger } from '@main/logging'
import { app } from 'electron'
import { getMonoOutputArgs, getNativeBinaryPath, NativeBridge } from '../native-bridge'
import { RecorderHandoffCoordinator } from './handoff-coordinator'
import { parseRecorderMessage } from './protocol'

const nativeLog = createMainDiagnosticLogger('native.recorder')
let handoffCoordinator: RecorderHandoffCoordinator
/** helper 每场后会强制重启；路线提示由主进程内存跨代持有，App 退出即清空 */
let preferredMicStrategyHint: { strategy: MicCaptureStrategy, deviceKey: string } | null = null

const bridge = new NativeBridge<RecorderEvents>({
  name: 'audio-recorder',
  writable: true,
  logStderr: true,
  args: getMonoOutputArgs(),
  onStderrLine: line => nativeLog.debug('native.stderr', line),
  onUnexpectedExit: (code, signal) => {
    /** helper 崩溃可能正由缓存路线触发；下次必须恢复完整探测，不能重复信任旧 hint */
    preferredMicStrategyHint = null
    bridge.events.emit('exited', { code, signal })
  },
  onHandoffComplete: generation => handoffCoordinator.onHandoffComplete(generation),
  onHandoffStarted: generation => handoffCoordinator.onHandoffStarted(generation),
  parseLine(line, bus) {
    try {
      const msg = parseRecorderMessage(line)
      if ('error' in msg) {
        if (msg.terminal === true) {
          preferredMicStrategyHint = null
        }
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
        if (msg.micStrategy && msg.micDeviceKey) {
          preferredMicStrategyHint = {
            strategy: msg.micStrategy,
            deviceKey: msg.micDeviceKey,
          }
        }
        /** deviceKey 是设备指纹，只留在主进程内存里，不随事件外发也不落日志 */
        bus.emit('recording', {
          path: msg.path,
          outputTransport: msg.outputTransport,
          strategy: msg.micStrategy,
          voiceProcessing: msg.micVoiceProcessing,
          voiceProcessingChannels: msg.micVoiceProcessingChannels,
        })
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
              bus.emit('stopped', {
                path: msg.path,
                duration: msg.duration ?? 0,
                systemAudioAppends: msg.systemAudioAppends,
                micAppends: msg.micAppends,
                systemAudioRequested: msg.systemAudioRequested,
                systemAudioCallbacks: msg.systemAudioCallbacks,
                systemAudioDrops: msg.systemAudioDrops,
              })
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
        /** 当前路线已无法持续出样；下次正式录音从完整降级链重新判断 */
        preferredMicStrategyHint = null
        /** 非致命：麦克风掉线且未能自愈，录音继续保留系统音轨 */
        console.warn(`[audio-recorder] mic degraded${msg.detail
          ? ` (${msg.detail})`
          : ''}`)
        bus.emit('mic_degraded', { detail: msg.detail })
      }
      else if (msg.status === 'tap_attach_failed') {
        /** 系统音轨缺失是数据丢失，不是噪声：录音仍在继续，但成品会少掉整条系统音轨 */
        nativeLog.warn('recorder.tap-attach-failed', 'system audio capture failed to attach mid-recording', {
          phase: msg.phase,
          detail: msg.detail,
        })
        bus.emit('tap_attach_failed', { phase: msg.phase, detail: msg.detail })
      }
      else if (msg.status === 'mic_route_changed') {
        /** 重挂会重新探测路线，旧提示可能已不成立 */
        preferredMicStrategyHint = null
        bus.emit('mic_route_changed', {
          reason: msg.reason,
          strategy: msg.micStrategy,
          voiceProcessing: msg.micVoiceProcessing,
          voiceProcessingChannels: msg.micVoiceProcessingChannels,
        })
      }
    }
    catch {
      console.warn('[audio-recorder] parse error:', line)
    }
  },
})

let micProbeBridge: NativeBridge<RecorderEvents> | null = null

/** 启动预检使用隔离 helper；惰性创建避免普通录音测试和非 macOS 运行时持有无用实例 */
function getMicProbeBridge(): NativeBridge<RecorderEvents> {
  if (micProbeBridge)
    return micProbeBridge

  const probeBridge = new NativeBridge<RecorderEvents>({
    name: 'audio-recorder-probe',
    binaryName: 'audio-recorder',
    writable: true,
    logStderr: true,
    onStderrLine: line => nativeLog.debug('native.probe.stderr', line),
    onUnexpectedExit: (code, signal) => {
      probeBridge.events.emit('exited', { code, signal })
    },
    parseLine(line, bus) {
      try {
        const msg = parseRecorderMessage(line)
        if (msg.status === 'mic_probe_complete') {
          preferredMicStrategyHint = {
            strategy: msg.micStrategy,
            deviceKey: msg.micDeviceKey,
          }
          bus.emit('mic_probe_complete', {
            strategy: msg.micStrategy,
            deviceKey: msg.micDeviceKey,
            voiceProcessing: msg.micVoiceProcessing,
            voiceProcessingChannels: msg.micVoiceProcessingChannels,
          })
        }
        else if (msg.status === 'mic_probe_failed') {
          bus.emit('mic_probe_failed', { detail: msg.detail })
        }
      }
      catch {
        nativeLog.warn('protocol.probe-parse-failed', 'failed to parse microphone probe message', { line })
      }
    },
  })
  micProbeBridge = probeBridge
  return probeBridge
}

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

/**
 * 已授权启动预检；使用隔离 helper，预检卡死或回收都不会影响正式录音
 *
 * 返回具名对象而不是裸 boolean：`ready` 只说明三条路线里有一条能出样，raw 兜底成功也是
 * true，恰好把「有没有系统回声消除」这个唯一有诊断价值的区分抹平了
 */
export async function probeMicCaptureStrategy(): Promise<MicCaptureProbeResult> {
  const probeBridge = getMicProbeBridge()
  if (!probeBridge.running)
    probeBridge.start()

  return new Promise<MicCaptureProbeResult>((resolve) => {
    let settled = false
    const finish = (result: MicCaptureProbeResult) => {
      if (settled)
        return
      settled = true
      clearTimeout(timeout)
      unsubscribeComplete()
      unsubscribeFailed()
      unsubscribeExited()
      /** SIGKILL 确保系统 API 卡住时也立即释放一次性进程；正式 helper 是另一进程 */
      probeBridge.stop('SIGKILL')
      resolve(result)
    }
    const unsubscribeComplete = probeBridge.events.on('mic_probe_complete', event => finish({
      ready: true,
      strategy: event.strategy,
      voiceProcessing: event.voiceProcessing,
      voiceProcessingChannels: event.voiceProcessingChannels,
    }))
    const unsubscribeFailed = probeBridge.events.on('mic_probe_failed', () => finish({ ready: false }))
    const unsubscribeExited = probeBridge.events.on('exited', () => finish({ ready: false }))
    const timeout = setTimeout(() => finish({ ready: false }), 5_000)
    if (!probeBridge.send(JSON.stringify({ action: 'probeMic', micAec: true })))
      finish({ ready: false })
  })
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
  const micHint = options?.engine === 'tap' && options.mic !== false
    ? preferredMicStrategyHint
    : null
  return bridge.send(JSON.stringify({
    action: 'start',
    outputPath: filePath,
    ...options,
    ...(micHint
      ? {
          preferredMicStrategy: micHint.strategy,
          preferredMicDeviceKey: micHint.deviceKey,
        }
      : {}),
  }))
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
  /** tap 引擎：是否优先尝试 Voice Processing AEC；@default true */
  micAec?: boolean
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

/** 启动预检结果；deviceKey 是设备指纹，刻意不外发，只留在主进程内存里做下次探测提示 */
export type MicCaptureProbeResult = {
  /** 三条采集路线里是否有一条能出样；raw 兜底成功同样为 true */
  ready: boolean
  strategy?: MicCaptureStrategy
  voiceProcessing?: MicVoiceProcessingOutcome
  /** VPIO 报的声道数，跨机型不固定（实测 5ch / 7ch），>2 时由 Swift 侧折成 ch0 */
  voiceProcessingChannels?: number
}

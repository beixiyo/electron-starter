/**
 * 原生录音 NDJSON 协议与主进程事件契约
 */

export function parseRecorderMessage(line: string): RecorderMessage {
  return JSON.parse(line) as RecorderMessage
}

export type RecorderEvents = {
  recording: { path: string, outputTransport?: string, micStrategy?: MicCaptureStrategy }
  paused: { path: string }
  mixing: { path: string }
  stopped: { path: string, duration: number } & SystemAudioTrackStats
  error: { code: string, detail?: string, path?: string, terminal: boolean }
  mic_degraded: { detail?: string }
  mic_route_changed: { reason: string, micStrategy?: MicCaptureStrategy }
  tap_attach_failed: { phase: TapAttachPhase, detail: string }
  mic_probe_complete: { strategy: MicCaptureStrategy, deviceKey: string }
  mic_probe_failed: { detail?: string }
  /** 归一化麦克风音量（0-1），录音期间约 15Hz */
  audio_level: { level: number }
  exited: { code: number | null, signal: NodeJS.Signals | null }
}

export type RecorderMessage
  = | {
    status: 'recording'
    path: string
    micStrategy?: MicCaptureStrategy
    micDeviceKey?: string
    outputTransport?: string
    duration?: never
    detail?: never
  }
  | { status: 'mic_probe_failed', detail?: string, path?: never, duration?: never }
  | { status: 'paused', path: string, duration?: never, detail?: never }
  | { status: 'mixing', path: string, duration?: never, detail?: never }
  | {
    status: 'stopped'
    path: string
    duration?: number
    handoffId?: number
    systemAudioAppends?: number
    micAppends?: number
    systemAudioRequested?: boolean
    systemAudioCallbacks?: number
    systemAudioDrops?: number
    detail?: never
  }
  | { status: 'tap_attach_failed', phase: TapAttachPhase, detail: string, path?: never, duration?: never }
  | {
    status: 'mic_route_changed'
    reason: string
    micStrategy?: MicCaptureStrategy
    path?: never
    duration?: never
  }
  | { status: 'mic_degraded', detail?: string, path?: never, duration?: never }
  | { status: 'audio_level', level: number, path?: never, duration?: never, detail?: never }
  | {
    status: 'mic_probe_complete'
    micStrategy: MicCaptureStrategy
    micDeviceKey: string
    path?: never
    duration?: never
    detail?: never
  }
  | { status: 'recycle_required', handoffId: number, detail?: string, path?: never, duration?: never }
  | { error: string, detail?: string, terminal?: false, path?: string, status?: never }
  | { error: string, detail?: string, terminal: true, path: string, handoffId?: number, status?: never }

export type MicCaptureStrategy = 'rawAudioEngine' | 'captureSession'

/** 系统音轨热挂失败的阶段；`description` 是构造 tap 描述，`prepare-or-start` 是建管线或启动 */
export type TapAttachPhase = 'description' | 'prepare-or-start'

/**
 * 一场录音结束时两条音轨各自的采集统计
 *
 * `systemAudioCallbacks` 与 `systemAudioAppends` 必须分开看：前者为 0 说明 tap 虽然挂上了
 * 但内核侧全程没出数据；前者非 0 而后者为 0 说明出了数据却全被丢弃。首样本看门狗只在
 * 两轨合计为 0 时触发，麦克风正常时整条系统音轨死掉对它不可见，只能靠这几个数发现
 */
export type SystemAudioTrackStats = {
  systemAudioAppends?: number
  micAppends?: number
  /** 本场是否请求了系统音轨；false 时其余统计为 0 属正常 */
  systemAudioRequested?: boolean
  systemAudioCallbacks?: number
  systemAudioDrops?: number
}

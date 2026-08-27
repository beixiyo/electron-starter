/**
 * 原生录音 NDJSON 协议与主进程事件契约
 */

export function parseRecorderMessage(line: string): RecorderMessage {
  return JSON.parse(line) as RecorderMessage
}

export type RecorderEvents = {
  recording: { path: string, outputTransport?: string } & MicVoiceProcessingInfo
  paused: { path: string }
  mixing: { path: string }
  stopped: { path: string, duration: number } & SystemAudioTrackStats
  error: { code: string, detail?: string, path?: string, terminal: boolean }
  mic_degraded: { detail?: string }
  mic_route_changed: { reason: string } & MicVoiceProcessingInfo
  tap_attach_failed: { phase: TapAttachPhase, detail: string }
  mic_probe_complete: { strategy: MicCaptureStrategy, deviceKey: string } & MicVoiceProcessingInfo
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
    micVoiceProcessing?: MicVoiceProcessingOutcome
    micVoiceProcessingChannels?: number
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
    micVoiceProcessing?: MicVoiceProcessingOutcome
    micVoiceProcessingChannels?: number
    path?: never
    duration?: never
  }
  | { status: 'mic_degraded', detail?: string, path?: never, duration?: never }
  | { status: 'audio_level', level: number, path?: never, duration?: never, detail?: never }
  | {
    status: 'mic_probe_complete'
    micStrategy: MicCaptureStrategy
    micDeviceKey: string
    micVoiceProcessing?: MicVoiceProcessingOutcome
    micVoiceProcessingChannels?: number
    path?: never
    duration?: never
    detail?: never
  }
  | { status: 'recycle_required', handoffId: number, detail?: string, path?: never, duration?: never }
  | { error: string, detail?: string, terminal?: false, path?: string, status?: never }
  | { error: string, detail?: string, terminal: true, path: string, handoffId?: number, status?: never }

export type MicCaptureStrategy = 'voiceProcessed' | 'rawAudioEngine' | 'captureSession'

/**
 * 本轮录音里系统回声消除 / 降噪（VPIO）的启用结果
 *
 * `active` 之外的取值都代表整场没有 AEC：外放通话时对端声音会延迟约 120ms 漏进麦克风
 * 再录一遍。取值语义与 Swift 侧 `MicVoiceProcessingOutcome` 一一对应，主进程按默认日志
 * 级别落盘，用于跨机型统计失败原因分布
 */
export type MicVoiceProcessingOutcome
  = | 'active'
    | 'not-attempted'
    | 'skipped-cached-route'
    | 'unavailable'
    | 'invalid-format'
    | 'unstable-channel-layout'
    | 'engine-start-failed'
    | 'no-samples'

/** VPIO 诊断字段；`micVoiceProcessingChannels` 仅在 `unstable-channel-layout` 下出现 */
export type MicVoiceProcessingInfo = {
  /** 本轮实际使用的采集路线；只有 `voiceProcessed` 带系统回声消除 */
  strategy?: MicCaptureStrategy
  voiceProcessing?: MicVoiceProcessingOutcome
  voiceProcessingChannels?: number
}

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

/**
 * 录音状态阶段（状态机）
 *
 * ```
 * native:  idle → starting → recording ⇄ paused → stopped
 * browser: idle → recording ⇄ paused → stopped
 * ```
 *
 * `starting` 表示 native helper 已接受启动意图，但音频设备和 writer 尚未就绪
 */
export type RecordingPhase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopped'

/**
 * Native 录音来源（录音由 Swift 子进程执行，renderer 不驱动浏览器采集）
 * - meeting: 会议检测触发，ScreenCaptureKit 全系统音频（依赖屏幕录制权限）
 * - manual: 手动录音，Core Audio tap 引擎（macOS 14.2+）——mic 恒采集，
 *   系统音轨按「混入系统音频」开关热挂/卸（依赖「仅系统音频录制」权限）
 */
export type NativeRecordingSource = 'meeting' | 'manual'

/**
 * 全局录音状态快照，由 Main Process 广播给所有 renderer
 */
export type RecordingSnapshot = {
  /** 当前状态阶段 */
  phase: RecordingPhase
  /** 已录制秒数（整秒） */
  elapsed: number
  /** native 录音来源；缺省 = renderer 浏览器 mic 录音 */
  nativeSource?: NativeRecordingSource
}

/** 单次录音最长时长（毫秒），到点自动暂停并提示用户 */
export const RECORDING_MAX_DURATION_MS = 2 * 60 * 60 * 1000

/** 录音状态机广播节拍（毫秒），驱动录音页计时刷新 */
export const RECORDING_TICK_MS = 1000

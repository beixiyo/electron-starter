import type { IpcContract } from '@ipc/core'
import type { RecordingSnapshot } from '@shared'

/**
 * 手动 native tap 录音 IPC 契约（macOS 14.2+ 混入系统音频）
 *
 * renderer 侧 recordingStore 据此驱动开录 / 停录 / 音源热切；主进程广播状态快照与完成 / 错误事件
 * 会议录音走独立的 meeting-detection 契约，二者互不影响
 */
export type RecordingContract = IpcContract<{
  getState: () => RecordingSnapshot
  /**
   * 开始手动录音：macOS 14.2+ 走 native tap 引擎（mic 恒采集，系统音轨按已同步的混音偏好挂载）
   * 更早系统 / 非 darwin 由 renderer 回退浏览器 mic 采集，不经过此入口
   */
  start: () => RecordingSnapshot
  /** 同步手动录音偏好（麦克风 / 混入系统音频开关）到主进程 */
  setManualRecordingPrefs: (prefs: ManualRecordingPrefs) => void
  /**
   * 手动 native 录音进行中热挂/卸音源（音源多选条：麦克风 + 所有软件）；
   * 每次变更下发完整音源状态；开启系统音轨且权限未定时会即时弹系统授权框，录音不中断
   */
  setAudioSourceCapture: (options: AudioSourceCaptureOptions) => AudioSourceCaptureResult
  /** 本机是否支持混系统音频录音（darwin 且 macOS >= 14.2），UI 据此显隐音源条 */
  getSystemAudioSupport: () => boolean
  pause: () => RecordingSnapshot
  resume: () => RecordingSnapshot
  stop: () => RecordingSnapshot
  reset: () => RecordingSnapshot
  /** 读取录音产物（可达几十 MB，异步读避免阻塞主进程） */
  readRecordingFile: (filePath: string) => ArrayBuffer
  /** 删除录音产物（存进 IndexedDB 后清理临时文件） */
  deleteRecordingFile: (filePath: string) => void
}, {
  stateChanged: RecordingSnapshot
  /** 录音达到最大时长：提示用户确认后再收尾 */
  showMaxDurationReached: undefined
  /** 手动 native 录音结束：产物已落临时目录，渲染端接手存 IndexedDB */
  manualRecordingComplete: ManualRecordingCompletePayload
  /** 手动 native 录音失败（定向主窗弹提示） */
  manualRecordingError: ManualRecordingErrorPayload
}>

/** renderer 同步给主进程的手动录音偏好 */
export type ManualRecordingPrefs = {
  /** 麦克风音源开关（localStorage 持久化值，默认开） */
  micEnabled: boolean
  /** 「混入系统音频（所有软件）」音源开关（localStorage 持久化值，默认关） */
  mixSystemAudio: boolean
}

export type AudioSourceCaptureOptions = {
  /** 麦克风音源是否采集 */
  micEnabled: boolean
  /** 系统音轨（所有软件）音源是否挂载（可能触发授权弹窗） */
  systemEnabled: boolean
}

export type AudioSourceCaptureResult = {
  ok: boolean
  /** 失败原因：非手动 native 录音中 / 系统音频权限被拒（此时系统音轨未挂，renderer 回退该源选中态） */
  reason?: 'not-recording' | 'permission-denied'
}

export type ManualRecordingCompletePayload = {
  /** 产物临时文件路径，renderer 经 readRecordingFile 取回后存 IndexedDB */
  path: string
  /** 录制时长（秒） */
  duration: number
  /** 产物 MIME（audio/mp4） */
  mimeType: string
}

export type ManualRecordingErrorPayload = {
  /** recorder-error: 录制中 Swift 子进程报错 */
  reason: 'recorder-error'
  /** 原始错误信息 */
  detail?: string
}

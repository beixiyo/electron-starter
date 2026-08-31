/**
 * 音频实验场设置
 *
 * 这些字段描述下一场 native 录音的明确策略。录制进行中不得修改，避免 UI 状态与
 * 已启动 helper 的实际配置分叉
 */
export type AudioLabSettings = {
  /** 最终成品声道数；1 适合语音和长录音，2 适合保留立体声媒体。 */
  outputChannels: 1 | 2
  /** 自动模式在 mic + system 同时采集时使用 WebRTC AEC3；off 明确关闭处理。 */
  echoCancellation: 'auto' | 'off'
  /** AEC3 外部延迟提示策略。 */
  delayMode: 'auto' | 'fixed' | 'hybrid'
  /** 固定/混合模式使用的延迟提示，单位毫秒。 */
  fixedDelayMs: number
  /** WebRTC APM 降噪级别。 */
  noiseSuppression: 'off' | 'low' | 'moderate' | 'high' | 'very-high'
  /** WebRTC APM 增益控制模式。 */
  gainControl: 'off' | 'agc1-adaptive-digital' | 'agc1-fixed' | 'agc2'
  /** 是否启用 WebRTC APM 高通。 */
  highPass: boolean
  /** 是否根据同时占用输入/输出的进程自动显示会议录音提示。 */
  meetingDetectionEnabled: boolean
}

/** renderer 向主进程提交的局部音频实验设置。 */
export type AudioLabSettingsPatch = Partial<AudioLabSettings>

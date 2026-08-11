// 集中生成两套录音引擎共用的 AAC 输出参数

import AVFoundation
import CoreAudio

// MARK: - AAC 编码参数（系统音轨 / mic 轨 / 混音成品三处写入器共用）

/**
 * 系统音轨 / 混音成品：2ch；质量策略由 AudioQualityTuning 统一提供
 *
 * Apple AAC 编码器的 2ch 码率上限随采样率变化：8k→48k，11/12k→64k，16k→96k，
 * 22.05/24k→128k，32k→192k，44.1/48k→320k。这里取调优目标与能力上限的较小值
 */
func aacSystemAudioSettings(sampleRate: Double = AUDIO_FALLBACK_SAMPLE_RATE) -> [String: Any] {
  let sampleRateBitRateLimit = switch sampleRate {
  case ...8_000: 48_000
  case ...12_000: 64_000
  case ...16_000: 96_000
  case ...24_000: 128_000
  case ...32_000: 192_000
  default: 320_000
  }

  return [
    AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
    AVSampleRateKey: sampleRate,
    AVNumberOfChannelsKey: 2,
    AVEncoderBitRateKey: min(SYSTEM_AUDIO_AAC_BIT_RATE, sampleRateBitRateLimit),
    AVEncoderAudioQualityKey: SYSTEM_AUDIO_AAC_ENCODER_QUALITY.rawValue,
  ]
}

/** SCK mic 轨：1ch，码率与编码质量由 AudioQualityTuning 统一提供 */
func aacMicSettings() -> [String: Any] {
  [
    AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
    AVSampleRateKey: 48000,
    AVNumberOfChannelsKey: 1,
    AVEncoderBitRateKey: MIC_AUDIO_AAC_BIT_RATE,
    AVEncoderAudioQualityKey: SYSTEM_AUDIO_AAC_ENCODER_QUALITY.rawValue,
  ]
}

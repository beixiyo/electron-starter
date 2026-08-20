// 集中生成两套录音引擎共用的 AAC 输出参数

import AVFoundation
import CoreAudio
import Foundation

// MARK: - AAC 编码参数（系统音轨 / mic 轨 / 混音成品三处写入器共用）

/**
 * 系统音轨 / 混音成品：声道数由 `channels` 决定，默认 2；质量策略由 AudioQualityTuning 统一提供
 *
 * Apple AAC 编码器的 2ch 码率上限随采样率变化：8k→48k，11/12k→64k，16k→96k，
 * 22.05/24k→128k，32k→192k，44.1/48k→320k。这里取调优目标与能力上限的较小值。
 * 单声道按每声道等比取半，稳妥落在编码器可接受区间内
 *
 * - Parameter channels: 输出声道数；最终成品由 `AUDIO_OUTPUT_CHANNEL_COUNT` 决定，实时系统音轨保持默认
 */
func aacSystemAudioSettings(
  sampleRate: Double = AUDIO_FALLBACK_SAMPLE_RATE,
  channels: Int = 2
) -> [String: Any] {
  let stereoBitRateLimit = switch sampleRate {
  case ...8_000: 48_000
  case ...12_000: 64_000
  case ...16_000: 96_000
  case ...24_000: 128_000
  case ...32_000: 192_000
  default: 320_000
  }
  let sampleRateBitRateLimit = channels >= 2
    ? stereoBitRateLimit
    : stereoBitRateLimit / 2

  return [
    AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
    AVSampleRateKey: sampleRate,
    AVNumberOfChannelsKey: channels,
    AVEncoderBitRateKey: min(SYSTEM_AUDIO_AAC_BIT_RATE, sampleRateBitRateLimit),
    AVEncoderAudioQualityKey: SYSTEM_AUDIO_AAC_ENCODER_QUALITY.rawValue,
  ]
}

/**
 * 单声道 LPCM 输出的声道布局
 *
 * AVFoundation 只给出 `AVNumberOfChannelsKey: 1` 时不保证把多声道源折叠成 mono，
 * 必须同时提供布局；2ch 使用默认 stereo 布局，无需显式指定
 */
func monoChannelLayoutData() -> Data {
  var layout = AudioChannelLayout()
  layout.mChannelLayoutTag = kAudioChannelLayoutTag_Mono
  return Data(bytes: &layout, count: MemoryLayout<AudioChannelLayout>.size)
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

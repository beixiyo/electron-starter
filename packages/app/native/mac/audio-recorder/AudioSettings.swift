import AVFoundation
import Cocoa
import CoreAudio
import CoreGraphics
import CoreMedia
import ScreenCaptureKit

// MARK: - AAC 编码参数（系统音轨 / mic 轨 / 混音成品三处写入器共用）

/** 系统音轨 / 混音成品：2ch 128k；48k 内的原生采样率透传，其余交写入器重采样 */
func aacSystemAudioSettings(sampleRate: Double = 48000) -> [String: Any] {
  [
    AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
    AVSampleRateKey: sampleRate,
    AVNumberOfChannelsKey: 2,
    AVEncoderBitRateKey: 128_000,
  ]
}

/** mic 轨：1ch 64k */
func aacMicSettings() -> [String: Any] {
  [
    AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
    AVSampleRateKey: 48000,
    AVNumberOfChannelsKey: 1,
    AVEncoderBitRateKey: 64_000,
  ]
}

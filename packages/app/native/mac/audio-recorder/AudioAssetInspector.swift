// 提供恢复与混音流程共用的音频资产可读性和非空轨检查

import AVFoundation
import CoreMedia
import Foundation

/** 读取 m4a 可读音频时长；文件不存在 / 无 moov / 不可解析时返回 .zero（视为不可用） */
func readableAudioDuration(_ url: URL) async -> CMTime {
  guard FileManager.default.fileExists(atPath: url.path) else { return .zero }
  let asset = AVURLAsset(url: url)
  do {
    let tracks = try await asset.loadTracks(withMediaType: .audio)
    var maxDuration = CMTime.zero
    for track in tracks {
      let range = try await track.load(.timeRange)
      if range.duration > maxDuration {
        maxDuration = range.duration
      }
    }
    return maxDuration
  }
  catch {
    return .zero
  }
}

func hasNonEmptyAudioTrack(_ url: URL) async -> Bool {
  let asset = AVURLAsset(url: url)
  do {
    let tracks = try await asset.loadTracks(withMediaType: .audio)
    return try await firstNonEmptyAudioTrack(tracks) != nil
  }
  catch {
    return false
  }
}

/**
 * 用两个有界 AVAssetReader 窗口验证输出真的能解码出 PCM
 *
 * 只读音轨时长无法识别 faststart m4a 在尾部被截断的情况：容器元数据仍可能保留完整时长，
 * 但实际音频数据已经读不到。这里分别读取开头和接近结尾的小窗口，并要求 reader 返回
 * 非零 PCM sample 与数据块；不会为了校验而解码整段长录音
 */
func hasDecodableAudioSamples(_ url: URL) async -> Bool {
  guard FileManager.default.fileExists(atPath: url.path) else { return false }

  let asset = AVURLAsset(url: url)
  do {
    let tracks = try await asset.loadTracks(withMediaType: .audio)
    for track in tracks {
      let timeRange = try await track.load(.timeRange)
      guard timeRange.duration.isNumeric, timeRange.duration > .zero else { continue }

      guard probeAudioSamples(
        asset: asset,
        track: track,
        timeRange: audioProbeRange(for: timeRange, atEnd: false)
      ) else {
        log("audio validation: no decodable PCM at start in \(url.lastPathComponent)")
        continue
      }

      guard probeAudioSamples(
        asset: asset,
        track: track,
        timeRange: audioProbeRange(for: timeRange, atEnd: true)
      ) else {
        log("audio validation: no decodable PCM near end in \(url.lastPathComponent)")
        continue
      }

      return true
    }
  }
  catch {
    log("audio validation: cannot load \(url.lastPathComponent): \(describeError(error))")
  }

  return false
}

private let audioProbeWindow = CMTime(seconds: 0.25, preferredTimescale: 600)

private let pcmProbeSettings: [String: Any] = [
  AVFormatIDKey: Int(kAudioFormatLinearPCM),
  AVLinearPCMIsFloatKey: true,
  AVLinearPCMBitDepthKey: 32,
  AVLinearPCMIsBigEndianKey: false,
  AVLinearPCMIsNonInterleaved: false,
]

private func audioProbeRange(for sourceRange: CMTimeRange, atEnd: Bool) -> CMTimeRange {
  let duration = CMTimeMinimum(sourceRange.duration, audioProbeWindow)
  guard atEnd else {
    return CMTimeRange(start: sourceRange.start, duration: duration)
  }

  let end = CMTimeRangeGetEnd(sourceRange)
  return CMTimeRange(start: CMTimeSubtract(end, duration), duration: duration)
}

private func probeAudioSamples(
  asset: AVAsset,
  track: AVAssetTrack,
  timeRange: CMTimeRange
) -> Bool {
  do {
    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: pcmProbeSettings)
    output.alwaysCopiesSampleData = false
    reader.timeRange = timeRange

    guard reader.canAdd(output) else {
      log("audio validation: reader cannot add audio output")
      return false
    }
    reader.add(output)

    guard reader.startReading() else {
      log("audio validation: reader start failed: \(describeError(reader.error))")
      return false
    }

    var sawPCM = false
    while let sampleBuffer = output.copyNextSampleBuffer() {
      guard CMSampleBufferDataIsReady(sampleBuffer) else {
        log("audio validation: PCM sample data is not ready")
        return false
      }
      guard CMSampleBufferGetNumSamples(sampleBuffer) > 0,
            let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
            let streamDescription = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription),
            streamDescription.pointee.mFormatID == kAudioFormatLinearPCM,
            let dataBuffer = CMSampleBufferGetDataBuffer(sampleBuffer),
            CMBlockBufferGetDataLength(dataBuffer) > 0
      else {
        continue
      }
      sawPCM = true
    }

    if reader.status == .completed {
      return sawPCM
    }
    if reader.status == .failed {
      log("audio validation: reader failed: \(describeError(reader.error))")
    }
    else if reader.status != .completed {
      log("audio validation: reader ended with status \(reader.status.rawValue)")
    }
  }
  catch {
    log("audio validation: cannot decode PCM window: \(describeError(error))")
  }

  return false
}

func firstNonEmptyAudioTrack(_ tracks: [AVAssetTrack]) async throws -> AVAssetTrack? {
  for track in tracks {
    let timeRange = try await track.load(.timeRange)
    if timeRange.duration > .zero {
      return track
    }
  }
  return nil
}

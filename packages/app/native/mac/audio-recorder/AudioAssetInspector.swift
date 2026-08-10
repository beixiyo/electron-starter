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

func firstNonEmptyAudioTrack(_ tracks: [AVAssetTrack]) async throws -> AVAssetTrack? {
  for track in tracks {
    let timeRange = try await track.load(.timeRange)
    if timeRange.duration > .zero {
      return track
    }
  }
  return nil
}

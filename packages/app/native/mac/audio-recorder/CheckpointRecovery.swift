// 校验、串接 checkpoint 分片，并以较完整的结果恢复主录音文件

import AVFoundation
import CoreMedia
import Foundation

func mergeCheckpointSegments(segmentDir: String, outputPath: String) async -> Bool {
  let fm = FileManager.default
  let dirURL = URL(fileURLWithPath: segmentDir, isDirectory: true)
  let outputURL = URL(fileURLWithPath: outputPath)

  do {
    let segmentURLs = try fm.contentsOfDirectory(at: dirURL, includingPropertiesForKeys: nil)
      .filter { $0.pathExtension == "m4a" }
      .filter { !$0.lastPathComponent.hasPrefix("_mix_") }
      .sorted { $0.lastPathComponent < $1.lastPathComponent }

    guard !segmentURLs.isEmpty else {
      log("checkpoint merge: no segments in \(segmentDir)")
      return false
    }

    var usableSegments: [URL] = []
    for segmentURL in segmentURLs {
      if await mixTracks(inputPath: segmentURL.path),
         await hasNonEmptyAudioTrack(segmentURL) {
        usableSegments.append(segmentURL)
      }
      else {
        log("checkpoint merge: skipped unusable segment \(segmentURL.lastPathComponent)")
      }
    }

    guard !usableSegments.isEmpty else {
      log("checkpoint merge: no usable segments")
      return false
    }

    let composition = AVMutableComposition()
    guard let compositionTrack = composition.addMutableTrack(
      withMediaType: .audio,
      preferredTrackID: kCMPersistentTrackID_Invalid
    ) else {
      log("checkpoint merge: cannot create composition track")
      return false
    }

    var cursor = CMTime.zero
    for segmentURL in usableSegments {
      let asset = AVURLAsset(url: segmentURL)
      let tracks = try await asset.loadTracks(withMediaType: .audio)
      guard let track = try await firstNonEmptyAudioTrack(tracks) else { continue }
      let timeRange = try await track.load(.timeRange)
      try compositionTrack.insertTimeRange(timeRange, of: track, at: cursor)
      cursor = CMTimeAdd(cursor, timeRange.duration)
    }

    guard cursor > .zero else {
      log("checkpoint merge: merged duration is zero")
      return false
    }

    let tmpURL = outputURL.deletingLastPathComponent()
      .appendingPathComponent("_mix_checkpoint_\(ProcessInfo.processInfo.globallyUniqueString).m4a")
    try? fm.removeItem(at: tmpURL)

    guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetAppleM4A) else {
      log("checkpoint merge: cannot create exporter")
      return false
    }
    exporter.outputURL = tmpURL
    exporter.outputFileType = .m4a

    await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
      exporter.exportAsynchronously {
        cont.resume()
      }
    }

    guard exporter.status == .completed else {
      log("checkpoint merge export failed: \(describeError(exporter.error))")
      try? fm.removeItem(at: tmpURL)
      return false
    }

    /**
     * outputPath 已存在且可读、时长不短于合并结果时保留主产物（如崩溃发生在主 writer
     * finishWriting 之后、锁清理之前）；崩溃残留的无 moov 半截主文件在此读不出时长（→ .zero），
     * 合并结果胜出并覆盖。绝不用 size>0 判定「已就绪」——那正是 checkpoint 要超越的弱防线。
     */
    let existingDuration = await readableAudioDuration(outputURL)
    if existingDuration >= cursor {
      log("checkpoint merge: existing output \(existingDuration.seconds)s >= merged \(cursor.seconds)s, keep existing")
      try? fm.removeItem(at: tmpURL)
      return true
    }

    try? fm.removeItem(at: outputURL)
    try fm.moveItem(at: tmpURL, to: outputURL)
    log("checkpoint merge: success (\(usableSegments.count) segment(s), \(cursor.seconds)s)")
    return true
  }
  catch {
    log("checkpoint merge error: \(describeError(error))")
    return false
  }
}

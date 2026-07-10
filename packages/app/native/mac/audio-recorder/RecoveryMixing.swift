import AVFoundation
import Cocoa
import CoreAudio
import CoreGraphics
import CoreMedia
import ScreenCaptureKit

func mixTracks(inputPath: String, extraInputPaths: [String] = []) async -> Bool {
  let inputURL = URL(fileURLWithPath: inputPath)
  let tmpURL = inputURL.deletingLastPathComponent()
    .appendingPathComponent("_mix_\(ProcessInfo.processInfo.globallyUniqueString).m4a")

  do {
    let composition = AVMutableComposition()
    var mixTracks: [AVAssetTrack] = []
    let inputPaths = [inputPath] + extraInputPaths

    for path in inputPaths {
      let url = URL(fileURLWithPath: path)
      guard FileManager.default.fileExists(atPath: url.path) else { continue }
      let asset = AVURLAsset(url: url)

      do {
        let allTracks = try await asset.loadTracks(withMediaType: .audio)
        for track in allTracks {
          let timeRange = try await track.load(.timeRange)
          log("mixTracks: \(url.lastPathComponent) track range=\(timeRange.start.seconds)s +\(timeRange.duration.seconds)s")
          if timeRange.duration > .zero,
             let compositionTrack = composition.addMutableTrack(
               withMediaType: .audio,
               preferredTrackID: kCMPersistentTrackID_Invalid
             ) {
            try compositionTrack.insertTimeRange(timeRange, of: track, at: .zero)
            mixTracks.append(compositionTrack)
          }
        }
      }
      catch {
        log("mixTracks: skipped \(url.lastPathComponent): \(describeError(error))")
      }
    }

    /**
     * 音源可录音中任意增减,收尾时非空轨可能是 1 条(纯系统 / 纯 mic)或 2 条(混音):
     * 都经 AVAssetReaderAudioMixOutput 转出单轨(1 条为直通,2 条为混合),产物永远干净单轨。
     * 0 条(全空,理论不达)才跳过
     */
    guard !mixTracks.isEmpty else {
      log("mixTracks: no non-empty track, skipping")
      return true
    }

    let reader = try AVAssetReader(asset: composition)

    let mixOutput = AVAssetReaderAudioMixOutput(
      audioTracks: mixTracks,
      audioSettings: [
        AVFormatIDKey: Int(kAudioFormatLinearPCM),
        AVLinearPCMIsFloatKey: true,
        AVLinearPCMBitDepthKey: 32,
        AVSampleRateKey: 48000,
        AVNumberOfChannelsKey: 2,
      ]
    )
    reader.add(mixOutput)

    let writer = try AVAssetWriter(outputURL: tmpURL, fileType: .m4a)
    let writerInput = AVAssetWriterInput(mediaType: .audio, outputSettings: aacSystemAudioSettings())
    writer.add(writerInput)

    reader.startReading()
    writer.startWriting()
    writer.startSession(atSourceTime: .zero)

    await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
      writerInput.requestMediaDataWhenReady(on: DispatchQueue(label: "mix-writer")) {
        while writerInput.isReadyForMoreMediaData {
          if let buf = mixOutput.copyNextSampleBuffer() {
            if !writerInput.append(buf) {
              writerInput.markAsFinished()
              cont.resume()
              return
            }
          }
          else {
            writerInput.markAsFinished()
            cont.resume()
            return
          }
        }
      }
    }

    await writer.finishWriting()

    /**
     * copyNextSampleBuffer() 在 reader 正常 EOF 与中途 .failed 时都返回 nil，无法区分。
     * 只查 writer.status 会把「解码中断→已写半截」误判为成功，进而用截断混音覆盖完整原件。
     * 必须同时核对 reader.status：任一非 completed 即中止，保留原件、删临时件。
     */
    guard reader.status == .completed, writer.status == .completed else {
      log("mixTracks aborted: reader=\(reader.status.rawValue)/\(describeError(reader.error)) writer=\(writer.status.rawValue)/\(describeError(writer.error))")
      try? FileManager.default.removeItem(at: tmpURL)
      return false
    }

    try? FileManager.default.removeItem(at: inputURL)
    try FileManager.default.moveItem(at: tmpURL, to: inputURL)
    log("mixTracks: success")
    return true
  }
  catch {
    log("mixTracks error: \(error.localizedDescription)")
    try? FileManager.default.removeItem(at: tmpURL)
    return false
  }
}

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

func recoverMicSidecar(sidecarPath: String, outputPath: String) async -> Bool {
  let fm = FileManager.default
  let sidecarURL = URL(fileURLWithPath: sidecarPath)
  let outputURL = URL(fileURLWithPath: outputPath)

  guard fm.fileExists(atPath: sidecarURL.path) else {
    log("mic sidecar recovery: missing sidecar \(sidecarPath)")
    return false
  }

  let sidecarDuration = await readableAudioDuration(sidecarURL)
  guard sidecarDuration > .zero else {
    log("mic sidecar recovery: unusable sidecar \(sidecarURL.lastPathComponent)")
    return false
  }

  /**
   * outputPath 可能是崩溃留下的不可播主文件、checkpoint 恢复出的系统音文件，
   * 或完全不存在。mixTracks 会跳过不可读输入，并把 sidecar 作为额外输入混入；
   * 因此这里统一走它，保证最终仍是正常 m4a。
   */
  guard await mixTracks(inputPath: outputPath, extraInputPaths: [sidecarPath]) else {
    log("mic sidecar recovery: mix failed for \(sidecarURL.lastPathComponent)")
    return false
  }

  let outputDuration = await readableAudioDuration(outputURL)
  guard outputDuration > .zero else {
    log("mic sidecar recovery: output unreadable after mix \(outputURL.lastPathComponent)")
    return false
  }

  consumeMicSidecarFile(sidecarURL, context: "mic sidecar recovery")
  log("mic sidecar recovery: success \(sidecarURL.lastPathComponent) -> \(outputURL.lastPathComponent) (\(outputDuration.seconds)s)")
  return true
}

func consumeMicSidecarFile(_ sidecarURL: URL, context: String) {
  let mergedURL = sidecarURL.appendingPathExtension("merged")
  do {
    try? FileManager.default.removeItem(at: mergedURL)
    try FileManager.default.moveItem(at: sidecarURL, to: mergedURL)
    try? FileManager.default.removeItem(at: mergedURL)
  }
  catch {
    log("\(context): sidecar consume failed \(sidecarURL.lastPathComponent): \(describeError(error))")
  }
}

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

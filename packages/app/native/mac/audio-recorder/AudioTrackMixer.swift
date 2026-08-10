// 将一个或多个音频资产解码、混合并原子替换为单轨 M4A

import AVFoundation
import CoreAudio
import CoreMedia
import Foundation

func mixTracks(
  inputPath: String,
  extraInputPaths: [String] = [],
  primaryInputVolume: Float = 1,
  primaryTimelineSegments: [AudioTimelineSegment] = []
) async -> Bool {
  let inputURL = URL(fileURLWithPath: inputPath)
  let tmpURL = inputURL.deletingLastPathComponent()
    .appendingPathComponent("_mix_\(ProcessInfo.processInfo.globallyUniqueString).m4a")

  do {
    let composition = AVMutableComposition()
    var mixTracks: [AVAssetTrack] = []
    var primaryMixTracks: [AVAssetTrack] = []
    let inputPaths = [inputPath] + extraInputPaths
    let maximumTimelineAdjustmentSeconds = 0.05

    for (inputIndex, path) in inputPaths.enumerated() {
      let url = URL(fileURLWithPath: path)
      guard FileManager.default.fileExists(atPath: url.path) else { continue }
      let asset = AVURLAsset(url: url)

      do {
        let allTracks = try await asset.loadTracks(withMediaType: .audio)
        for track in allTracks {
          let timeRange = try await track.load(.timeRange)
          log("mixTracks: \(url.lastPathComponent) track range=\(timeRange.start.seconds)s +\(timeRange.duration.seconds)s")
          if timeRange.duration > .zero {
            var timelineError: String?
            var timelineDuration = CMTime.zero
            var previousEnd: CMTime?
            for segment in primaryTimelineSegments {
              guard segment.start.isNumeric,
                    segment.start >= .zero,
                    segment.duration.isNumeric,
                    segment.duration > .zero else {
                timelineError = "contains invalid start or duration"
                break
              }
              if let previousEnd, segment.start < previousEnd {
                timelineError = "contains out-of-order or overlapping segments"
                break
              }
              previousEnd = CMTimeAdd(segment.start, segment.duration)
              timelineDuration = CMTimeAdd(timelineDuration, segment.duration)
            }

            if timelineError == nil, !primaryTimelineSegments.isEmpty {
              let durationDifference = abs(timeRange.duration.seconds - timelineDuration.seconds)
              if !durationDifference.isFinite || durationDifference > maximumTimelineAdjustmentSeconds {
                timelineError = "source/segment duration mismatch \(String(format: "%.3f", durationDifference))s"
              }
            }

            guard let compositionTrack = composition.addMutableTrack(
               withMediaType: .audio,
               preferredTrackID: kCMPersistentTrackID_Invalid
             ) else { continue }

            if inputIndex == 0,
               allTracks.count == 1,
               !primaryTimelineSegments.isEmpty,
               timelineError == nil {
              var sourceCursor = timeRange.start
              var remainingDuration = timeRange.duration

              for (segmentIndex, segment) in primaryTimelineSegments.enumerated()
                where remainingDuration > .zero {
                /** AAC 会把输入 PTS 空洞压紧，最后一段吸收编码 priming/padding 的微小差值 */
                let duration = segmentIndex == primaryTimelineSegments.count - 1
                  ? remainingDuration
                  : CMTimeMinimum(segment.duration, remainingDuration)
                try compositionTrack.insertTimeRange(
                  CMTimeRange(start: sourceCursor, duration: duration),
                  of: track,
                  at: segment.start
                )
                sourceCursor = CMTimeAdd(sourceCursor, duration)
                remainingDuration = CMTimeSubtract(remainingDuration, duration)
              }
            }
            else {
              if inputIndex == 0,
                 allTracks.count == 1,
                 !primaryTimelineSegments.isEmpty,
                 let timelineError {
                log("mixTracks: primary timeline ignored: \(timelineError)")
              }
              try compositionTrack.insertTimeRange(timeRange, of: track, at: .zero)
            }
            mixTracks.append(compositionTrack)
            if inputIndex == 0 {
              primaryMixTracks.append(compositionTrack)
            }
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
    if primaryInputVolume < 1, !primaryMixTracks.isEmpty, mixTracks.count > primaryMixTracks.count {
      let audioMix = AVMutableAudioMix()
      audioMix.inputParameters = primaryMixTracks.map { track in
        let parameters = AVMutableAudioMixInputParameters(track: track)
        parameters.setVolume(primaryInputVolume, at: .zero)
        return parameters
      }
      mixOutput.audioMix = audioMix
      log("mixTracks: primary input volume=\(primaryInputVolume)")
    }
    reader.add(mixOutput)

    let writer = try AVAssetWriter(outputURL: tmpURL, fileType: .m4a)
    let writerInput = AVAssetWriterInput(mediaType: .audio, outputSettings: aacSystemAudioSettings())
    writer.add(writerInput)

    reader.startReading()
    writer.startWriting()
    writer.startSession(atSourceTime: .zero)

    /** AVFoundation 未为这两个类标注 Sendable，它们在此后只由 mix-writer 串行队列使用 */
    nonisolated(unsafe) let queueWriterInput = writerInput
    nonisolated(unsafe) let queueMixOutput = mixOutput
    await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
      queueWriterInput.requestMediaDataWhenReady(on: DispatchQueue(label: "mix-writer")) {
        while queueWriterInput.isReadyForMoreMediaData {
          if let buf = queueMixOutput.copyNextSampleBuffer() {
            if !queueWriterInput.append(buf) {
              queueWriterInput.markAsFinished()
              cont.resume()
              return
            }
          }
          else {
            queueWriterInput.markAsFinished()
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

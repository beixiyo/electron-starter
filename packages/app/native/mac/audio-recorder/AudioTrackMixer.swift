// 编排音频 passthrough / render，并安全写入最终单轨文件

import AVFoundation
import CoreAudio
import CoreMedia
import Darwin
import Foundation

func mixTracks(
  inputPath: String,
  extraInputPaths: [String] = [],
  primaryInputVolume: Float = 1,
  primaryInputVolumesByChannelCount: [UInt32: Float] = [:],
  primaryTimelineSegments: [AudioTimelineSegment] = []
) async -> Bool {
  let inputURL = URL(fileURLWithPath: inputPath)
  let tmpURL = inputURL.deletingLastPathComponent()
    .appendingPathComponent("_mix_\(ProcessInfo.processInfo.globallyUniqueString).m4a")

  do {
    let primaryInspection = await inspectMixInput(at: inputPath)
    var extraInspections: [MixInputInspection] = []
    for path in extraInputPaths {
      extraInspections.append(await inspectMixInput(at: path))
    }

    /** 主文件存在却无法解析时必须保留原件，不能用 sidecar-only 结果覆盖潜在可恢复的系统音 */
    guard primaryInspection.succeeded else {
      log("mixTracks: render aborted: primary input inspection failed")
      return false
    }

    /** 无法确认 extra 是否含音频时不能当成空输入，否则调用方可能误删尚未混入的 sidecar */
    guard extraInspections.allSatisfy(\.succeeded) else {
      log("mixTracks: render aborted: extra input inspection failed")
      return false
    }

    let primaryInput = primaryInspection.input
    let extraInputs = extraInspections.compactMap(\.input)
    /** 混音总线使用所有有效输入的最高采样率，避免低采样率系统轨拖低 48 kHz mic */
    let sampleRate = ([primaryInput].compactMap { $0 } + extraInputs)
      .flatMap(\.nonEmptyTracks)
      .compactMap(\.sampleRate)
      .max()
      ?? AUDIO_FALLBACK_SAMPLE_RATE

    if canPassthrough(
      primaryInput: primaryInput,
      extraInputs: extraInputs,
      primaryInputVolume: primaryInputVolume,
      primaryInputVolumesByChannelCount: primaryInputVolumesByChannelCount,
      primaryTimelineSegments: primaryTimelineSegments,
      targetChannelCount: AUDIO_OUTPUT_CHANNEL_COUNT
    ) {
      log("mixTracks: passthrough \(inputURL.lastPathComponent) (single identity primary track)")
      return true
    }

    let renderPlan = try makeRenderPlan(
      primaryInput: primaryInput,
      extraInputs: extraInputs,
      primaryTimelineSegments: primaryTimelineSegments
    )
    guard !renderPlan.mixTracks.isEmpty else {
      log("mixTracks: render aborted: no non-empty track")
      return false
    }

    log(
      "mixTracks: render \(inputURL.lastPathComponent) "
        + "tracks=\(renderPlan.mixTracks.count) sampleRate=\(Int(sampleRate))Hz"
    )
    guard await render(
      plan: renderPlan,
      sampleRate: sampleRate,
      primaryInputVolume: primaryInputVolume,
      primaryInputVolumesByChannelCount: primaryInputVolumesByChannelCount,
      outputURL: tmpURL
    ) else {
      try? FileManager.default.removeItem(at: tmpURL)
      return false
    }

    try replaceOutputAtomically(at: inputURL, with: tmpURL)
    log("mixTracks: render success")
    return true
  }
  catch {
    log("mixTracks error: \(describeError(error))")
    try? FileManager.default.removeItem(at: tmpURL)
    return false
  }
}

private func render(
  plan: MixRenderPlan,
  sampleRate: Double,
  primaryInputVolume: Float,
  primaryInputVolumesByChannelCount: [UInt32: Float],
  outputURL: URL
) async -> Bool {
  do {
    guard primaryInputVolume.isFinite, primaryInputVolume >= .zero else {
      throw mixerError("invalid primary input volume: \(primaryInputVolume)")
    }
    guard primaryInputVolumesByChannelCount.values.allSatisfy({ $0.isFinite && $0 >= .zero }) else {
      throw mixerError("invalid channel-specific primary input volume")
    }

    let primaryTrackVolumes = plan.primaryMixTracks.map { source in
      source.sourceChannelCount.flatMap { primaryInputVolumesByChannelCount[$0] }
        ?? primaryInputVolume
    }

    let outputChannelCount = AUDIO_OUTPUT_CHANNEL_COUNT
    var pcmSettings: [String: Any] = [
      AVFormatIDKey: Int(kAudioFormatLinearPCM),
      AVLinearPCMIsFloatKey: true,
      AVLinearPCMBitDepthKey: 32,
      AVLinearPCMIsNonInterleaved: false,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: outputChannelCount,
    ]
    if outputChannelCount == 1 {
      pcmSettings[AVChannelLayoutKey] = monoChannelLayoutData()
    }

    let reader = try AVAssetReader(asset: plan.composition)
    let mixOutput = AVAssetReaderAudioMixOutput(
      audioTracks: plan.mixTracks,
      audioSettings: pcmSettings
    )
    if primaryTrackVolumes.contains(where: { $0 != 1 }) {
      let audioMix = AVMutableAudioMix()
      audioMix.inputParameters = zip(plan.primaryMixTracks, primaryTrackVolumes).map { source, volume in
        let parameters = AVMutableAudioMixInputParameters(track: source.track)
        parameters.setVolume(volume, at: .zero)
        return parameters
      }
      mixOutput.audioMix = audioMix
      log("mixTracks: render primary input volumes=\(primaryTrackVolumes)")
    }
    guard reader.canAdd(mixOutput) else {
      throw mixerError("cannot add reader output")
    }
    reader.add(mixOutput)

    /** 多轨相加或单轨主动放大时才限幅；未增益的单轨时间线 render 保持原始样本 */
    let limiter = plan.mixTracks.count > 1 || primaryTrackVolumes.contains(where: { $0 > 1 })
      ? try AudioPeakLimiter(sampleRate: sampleRate, channelCount: outputChannelCount)
      : nil

    let writer = try AVAssetWriter(outputURL: outputURL, fileType: .m4a)
    let outputSettings = aacSystemAudioSettings(sampleRate: sampleRate, channels: outputChannelCount)
    let writerInput = try addAudioWriterInput(
      to: writer,
      outputSettings: outputSettings,
      expectsMediaDataInRealTime: false
    )
    try startAudioWriter(writer)
    writer.startSession(atSourceTime: .zero)
    guard reader.startReading() else {
      log("mixTracks: render reader start failed: \(describeError(reader.error))")
      writer.cancelWriting()
      return false
    }

    /** AVFoundation 未为这两个类标注 Sendable，它们在此后只由 mix-writer 串行队列使用 */
    nonisolated(unsafe) let queueWriterInput = writerInput
    nonisolated(unsafe) let queueMixOutput = mixOutput
    nonisolated(unsafe) let queueLimiter = limiter
    var limiterError: Error?
    await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
      queueWriterInput.requestMediaDataWhenReady(on: DispatchQueue(label: "mix-writer")) {
        while queueWriterInput.isReadyForMoreMediaData {
          if let buffer = queueMixOutput.copyNextSampleBuffer() {
            let bufferToAppend: CMSampleBuffer
            do {
              bufferToAppend = try queueLimiter?.process(buffer) ?? buffer
            }
            catch {
              limiterError = error
              log("mixTracks: limiter failed: \(describeError(error))")
              queueWriterInput.markAsFinished()
              cont.resume()
              return
            }
            if !queueWriterInput.append(bufferToAppend) {
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

    if let limiterError {
      reader.cancelReading()
      writer.cancelWriting()
      log("mixTracks: render aborted after limiter failure: \(describeError(limiterError))")
      return false
    }

    await writer.finishWriting()

    /** reader 正常 EOF 与失败均返回 nil；两端都 completed 才能覆盖原文件 */
    guard reader.status == .completed, writer.status == .completed else {
      log(
        "mixTracks: render aborted: "
          + "reader=\(reader.status.rawValue)/\(describeError(reader.error)) "
          + "writer=\(writer.status.rawValue)/\(describeError(writer.error))"
      )
      return false
    }
    guard await readableAudioDuration(outputURL) > .zero else {
      log("mixTracks: render aborted: output has no readable audio")
      return false
    }
    return true
  }
  catch {
    log("mixTracks: render error: \(describeError(error))")
    return false
  }
}

/**
 * 临时件与目标在同一目录，先同步临时件内容，再用 POSIX rename 单次原子替换
 * rename 后目录同步失败不会回滚已提交的新 inode，只记录诊断并保留事务证据；回滚
 * 不能安全地把已经变化的 output 覆盖回去
 */
func replaceOutputAtomically(at outputURL: URL, with temporaryURL: URL) throws {
  try syncFileContents(at: temporaryURL)
  let result = temporaryURL.path.withCString { sourcePath in
    outputURL.path.withCString { destinationPath in
      Darwin.rename(sourcePath, destinationPath)
    }
  }
  guard result == 0 else {
    let errorCode = errno
    throw NSError(
      domain: NSPOSIXErrorDomain,
      code: Int(errorCode),
      userInfo: [NSFilePathErrorKey: outputURL.path]
    )
  }

  do {
    try syncContainingDirectory(of: outputURL)
  }
  catch {
    log("atomic output rename committed but directory fsync failed: \(describeError(error))")
  }
}

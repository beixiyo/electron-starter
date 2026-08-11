// 预检混音资产，并生成 passthrough 判定或 composition 渲染计划

import AVFoundation
import CoreAudio
import CoreMedia
import Foundation

private let maximumTimelineAdjustmentSeconds = 0.05

func inspectMixInput(at path: String) async -> MixInputInspection {
  let url = URL(fileURLWithPath: path)
  let fileManager = FileManager.default
  guard fileManager.fileExists(atPath: url.path) else {
    return MixInputInspection(input: nil, succeeded: true)
  }

  do {
    let attributes = try fileManager.attributesOfItem(atPath: url.path)
    if (attributes[.size] as? NSNumber)?.uint64Value == 0 {
      /** mic-only 会预建但不启动系统 writer；其 0B 占位文件不应阻止 sidecar 生成最终产物 */
      return MixInputInspection(input: nil, succeeded: true)
    }
  }
  catch {
    log("mixTracks: cannot inspect \(url.lastPathComponent): \(describeError(error))")
    return MixInputInspection(input: nil, succeeded: false)
  }

  let asset = AVURLAsset(url: url)
  do {
    let allTracks = try await asset.loadTracks(withMediaType: .audio)
    var nonEmptyTracks: [MixSourceTrack] = []

    for track in allTracks {
      let timeRange = try await track.load(.timeRange)
      log(
        "mixTracks: \(url.lastPathComponent) track range="
          + "\(timeRange.start.seconds)s +\(timeRange.duration.seconds)s"
      )
      guard timeRange.duration.isNumeric, timeRange.duration > .zero else { continue }

      let sourceFormat = await nativeAudioFormat(of: track)
      nonEmptyTracks.append(MixSourceTrack(
        track: track,
        timeRange: timeRange,
        sampleRate: sourceFormat?.sampleRate,
        channelCount: sourceFormat?.channelCount
      ))
    }

    return MixInputInspection(
      input: MixInput(
        asset: asset,
        audioTrackCount: allTracks.count,
        nonEmptyTracks: nonEmptyTracks
      ),
      succeeded: true
    )
  }
  catch {
    log("mixTracks: skipped \(url.lastPathComponent): \(describeError(error))")
    return MixInputInspection(input: nil, succeeded: false)
  }
}

func canPassthrough(
  primaryInput: MixInput?,
  extraInputs: [MixInput],
  primaryInputVolume: Float,
  primaryInputVolumesByChannelCount: [UInt32: Float],
  primaryTimelineSegments: [AudioTimelineSegment]
) -> Bool {
  guard let primaryInput,
        primaryInput.nonEmptyTracks.count == 1,
        extraInputs.allSatisfy({ $0.nonEmptyTracks.isEmpty })
  else {
    return false
  }

  let source = primaryInput.nonEmptyTracks[0]
  let effectiveVolume = source.channelCount.flatMap { primaryInputVolumesByChannelCount[$0] }
    ?? primaryInputVolume
  guard effectiveVolume == 1 else { return false }

  guard !primaryTimelineSegments.isEmpty else { return true }
  guard primaryTimelineSegments.count == 1 else { return false }

  let sourceRange = source.timeRange
  guard primaryTimelineError(
    primaryTimelineSegments,
    sourceDuration: sourceRange.duration
  ) == nil else {
    return false
  }

  let segmentStart = primaryTimelineSegments[0].start.seconds
  let sourceStart = sourceRange.start.seconds
  let startDifference = abs(segmentStart - sourceStart)

  return segmentStart.isFinite
    && sourceStart.isFinite
    && abs(segmentStart) <= maximumTimelineAdjustmentSeconds
    && abs(sourceStart) <= maximumTimelineAdjustmentSeconds
    && startDifference <= maximumTimelineAdjustmentSeconds
}

func makeRenderPlan(
  primaryInput: MixInput?,
  extraInputs: [MixInput],
  primaryTimelineSegments: [AudioTimelineSegment]
) throws -> MixRenderPlan {
  let composition = AVMutableComposition()
  var mixTracks: [AVAssetTrack] = []
  var primaryMixTracks: [MixPrimaryTrack] = []

  /**
   * 0B / 缺失主轨时仍应尽量保全 mic sidecar；时间轴只描述系统主轨，
   * 没有 primary 就没有可应用对象。非零但损坏的主文件已在 inspectMixInput fail closed。
   */
  let appliesPrimaryTimeline = primaryInput != nil && !primaryTimelineSegments.isEmpty
  if appliesPrimaryTimeline {
    guard let primaryInput,
          primaryInput.audioTrackCount == 1,
          primaryInput.nonEmptyTracks.count == 1 else {
      throw mixerError("primary timeline requires exactly one non-empty primary track")
    }
    if let timelineError = primaryTimelineError(
      primaryTimelineSegments,
      sourceDuration: primaryInput.nonEmptyTracks[0].timeRange.duration
    ) {
      throw mixerError("invalid primary timeline: \(timelineError)")
    }
  }

  if let primaryInput {
    for source in primaryInput.nonEmptyTracks {
      let compositionTrack = try addCompositionTrack(to: composition)
      if appliesPrimaryTimeline {
        try insertPrimaryTimeline(
          primaryTimelineSegments,
          source: source,
          into: compositionTrack
        )
      }
      else {
        try compositionTrack.insertTimeRange(source.timeRange, of: source.track, at: .zero)
      }
      mixTracks.append(compositionTrack)
      primaryMixTracks.append(MixPrimaryTrack(
        track: compositionTrack,
        sourceChannelCount: source.channelCount
      ))
    }
  }

  for input in extraInputs {
    for source in input.nonEmptyTracks {
      let compositionTrack = try addCompositionTrack(to: composition)
      try compositionTrack.insertTimeRange(source.timeRange, of: source.track, at: .zero)
      mixTracks.append(compositionTrack)
    }
  }

  return MixRenderPlan(
    composition: composition,
    mixTracks: mixTracks,
    primaryMixTracks: primaryMixTracks
  )
}

private func nativeAudioFormat(of track: AVAssetTrack) async -> MixSourceFormat? {
  guard let descriptions = try? await track.load(.formatDescriptions) else { return nil }

  for description in descriptions {
    guard let streamDescription = CMAudioFormatDescriptionGetStreamBasicDescription(description) else {
      continue
    }
    let sampleRate = streamDescription.pointee.mSampleRate
    guard sampleRate.isFinite, sampleRate > 0 else { continue }
    return MixSourceFormat(
      sampleRate: SUPPORTED_AAC_SAMPLE_RATES.contains(sampleRate)
        ? sampleRate
        : AUDIO_FALLBACK_SAMPLE_RATE,
      channelCount: streamDescription.pointee.mChannelsPerFrame
    )
  }
  return nil
}

private func primaryTimelineError(
  _ segments: [AudioTimelineSegment],
  sourceDuration: CMTime
) -> String? {
  var timelineDuration = CMTime.zero
  var previousEnd: CMTime?

  for segment in segments {
    guard segment.start.isNumeric,
          segment.start >= .zero,
          segment.duration.isNumeric,
          segment.duration > .zero else {
      return "contains invalid start or duration"
    }
    if let previousEnd, segment.start < previousEnd {
      return "contains out-of-order or overlapping segments"
    }
    previousEnd = CMTimeAdd(segment.start, segment.duration)
    timelineDuration = CMTimeAdd(timelineDuration, segment.duration)
  }

  let durationDifference = abs(sourceDuration.seconds - timelineDuration.seconds)
  if !durationDifference.isFinite || durationDifference > maximumTimelineAdjustmentSeconds {
    return "source/segment duration mismatch \(String(format: "%.3f", durationDifference))s"
  }
  return nil
}

private func addCompositionTrack(to composition: AVMutableComposition) throws -> AVMutableCompositionTrack {
  guard let track = composition.addMutableTrack(
    withMediaType: .audio,
    preferredTrackID: kCMPersistentTrackID_Invalid
  ) else {
    throw mixerError("cannot create composition track")
  }
  return track
}

private func insertPrimaryTimeline(
  _ segments: [AudioTimelineSegment],
  source: MixSourceTrack,
  into compositionTrack: AVMutableCompositionTrack
) throws {
  var sourceCursor = source.timeRange.start
  var remainingDuration = source.timeRange.duration

  for (segmentIndex, segment) in segments.enumerated() where remainingDuration > .zero {
    /** AAC 会把输入 PTS 空洞压紧，最后一段吸收编码 priming / padding 的微小差值 */
    let duration = segmentIndex == segments.count - 1
      ? remainingDuration
      : CMTimeMinimum(segment.duration, remainingDuration)
    try compositionTrack.insertTimeRange(
      CMTimeRange(start: sourceCursor, duration: duration),
      of: source.track,
      at: segment.start
    )
    sourceCursor = CMTimeAdd(sourceCursor, duration)
    remainingDuration = CMTimeSubtract(remainingDuration, duration)
  }
}

func mixerError(_ description: String) -> NSError {
  NSError(
    domain: "AudioTrackMixer",
    code: 1,
    userInfo: [NSLocalizedDescriptionKey: description]
  )
}

struct MixInputInspection {
  let input: MixInput?
  let succeeded: Bool
}

struct MixInput {
  /** 显式持有 asset，保证 composition 插轨前 source track 的所有者仍存活 */
  let asset: AVURLAsset
  let audioTrackCount: Int
  let nonEmptyTracks: [MixSourceTrack]
}

struct MixSourceTrack {
  let track: AVAssetTrack
  let timeRange: CMTimeRange
  let sampleRate: Double?
  let channelCount: UInt32?
}

private struct MixSourceFormat {
  let sampleRate: Double
  let channelCount: UInt32
}

struct MixPrimaryTrack {
  let track: AVAssetTrack
  let sourceChannelCount: UInt32?
}

struct MixRenderPlan {
  let composition: AVMutableComposition
  let mixTracks: [AVAssetTrack]
  let primaryMixTracks: [MixPrimaryTrack]
}

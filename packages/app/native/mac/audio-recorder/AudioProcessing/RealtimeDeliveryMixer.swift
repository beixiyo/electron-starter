// 在录制期间持续生成有界缓冲的单声道 AAC 成品，避免 stop 阶段整轨混音

import AVFoundation
import CoreMedia
import Foundation

public struct RealtimeDeliveryResult: Sendable {
  public let filePath: String?
  public let frameCount: Int64
  /** 录音墙钟晚于最后一帧真实输入时，未合成的尾部静音帧数 */
  public let omittedTrailingFrames: Int64
  public let droppedInputBuffers: Int
  public let errorDescription: String?
}

/**
 * 录制期单轨交付混音器
 *
 * 系统音、正式 raw mic fallback 与 AEC clean mic 都按 48 kHz 逻辑时间写入有界窗口
 * AEC clean 暂时落后时最多等待固定窗口，之后只对缺失小段使用 raw mic；任何一路断流
 * 都不会无限积压另一轨。输出直接编码为临时 M4A，stop 只负责关闭容器与原子安装
 */
public final class RealtimeDeliveryMixer: @unchecked Sendable {
  private enum Policy {
    static let outputChunkFrames = AUDIO_PROCESSING_SAMPLE_RATE / 10
    /** stop 最多补一个输出块，吸收最后一帧 callback 到用户点击停止之间的正常尾差 */
    static let maximumTrailingSynthesisFrames = outputChunkFrames
    static let maximumSourceWaitFrames = AUDIO_PROCESSING_SAMPLE_RATE * 2
    static let maximumPendingBuffers = 2_048
    /** 实时交付策略不反向依赖可执行层；值与正式 AudioPeakLimiter 策略保持一致 */
    static let limiterCeiling: Float = 0.95
    static let limiterReleaseSeconds = 0.08
  }

  private let queue = DispatchQueue(label: "audio-recorder-realtime-delivery", qos: .userInitiated)
  private let pendingLock = NSLock()
  private let outputURL: URL
  private let outputSettings: [String: Any]
  private let logger: (String) -> Void
  private let expectsPreferredMic: Bool
  private let systemNormalizer: PCMBufferNormalizer
  private let fallbackMicNormalizer: PCMBufferNormalizer
  private let preferredMicNormalizer: PCMBufferNormalizer

  private var pendingBuffers = 0
  private var droppedInputBuffers = 0
  private var backpressureLogged = false
  private var systemTimeline = DeliveryTimeline()
  private var fallbackMicTimeline = DeliveryTimeline()
  private var preferredMicTimeline = DeliveryTimeline()
  private var systemEnabled: Bool
  private var micEnabled: Bool
  private var preferredMicEnabled: Bool
  private var everMixedMic: Bool
  private var nextOutputFrame: Int64 = 0
  private var outputFrameCount: Int64 = 0
  private var omittedTrailingFrames: Int64 = 0
  private var acceptedInputBuffers = 0
  private var outputFile: AVAudioFile?
  private var processingError: Error?
  private var finished = false
  private var limiterGain: Float = 1

  public init(
    outputPath: String,
    outputSettings: [String: Any],
    initialSystemEnabled: Bool,
    initialMicEnabled: Bool,
    expectsPreferredMic: Bool,
    logger: @escaping (String) -> Void = { _ in }
  ) throws {
    let finalURL = URL(fileURLWithPath: outputPath)
    outputURL = finalURL.deletingLastPathComponent()
      .appendingPathComponent("_realtime_\(finalURL.lastPathComponent)")
    self.outputSettings = outputSettings
    self.logger = logger
    self.expectsPreferredMic = expectsPreferredMic
    systemEnabled = initialSystemEnabled
    micEnabled = initialMicEnabled
    preferredMicEnabled = expectsPreferredMic && initialSystemEnabled && initialMicEnabled
    everMixedMic = initialMicEnabled
    systemNormalizer = try PCMBufferNormalizer(downmixMode: .average)
    fallbackMicNormalizer = try PCMBufferNormalizer(downmixMode: .average)
    preferredMicNormalizer = try PCMBufferNormalizer(downmixMode: .first)
    try? FileManager.default.removeItem(at: outputURL)
  }

  public func appendSystem(_ sampleBuffer: CMSampleBuffer, logicalTimeSeconds: Double) {
    guard let copied = PCMBufferNormalizer.copy(sampleBuffer) else {
      recordDroppedInput("system PCM copy failed")
      return
    }
    enqueue(copied, kind: .system, logicalTimeSeconds: logicalTimeSeconds)
  }

  /** 行为测试与已归一化上游可直接提交 PCM，生产 capture 仍走 CMSampleBuffer 深拷贝入口 */
  public func appendSystemPCM(_ buffer: AVAudioPCMBuffer, logicalTimeSeconds: Double) {
    guard let copied = PCMBufferNormalizer.copy(buffer) else {
      recordDroppedInput("system PCM copy failed")
      return
    }
    enqueue(copied, kind: .system, logicalTimeSeconds: logicalTimeSeconds)
  }

  public func appendFallbackMic(_ buffer: AVAudioPCMBuffer, logicalTimeSeconds: Double) {
    guard let copied = PCMBufferNormalizer.copy(buffer) else {
      recordDroppedInput("fallback mic PCM copy failed")
      return
    }
    enqueue(copied, kind: .fallbackMic, logicalTimeSeconds: logicalTimeSeconds)
  }

  public func appendPreferredMic(_ buffer: AVAudioPCMBuffer, logicalTimeSeconds: Double) {
    guard let copied = PCMBufferNormalizer.copy(buffer) else {
      recordDroppedInput("preferred mic PCM copy failed")
      return
    }
    enqueue(copied, kind: .preferredMic, logicalTimeSeconds: logicalTimeSeconds)
  }

  /**
   * 在物理设备或进程集合切换边界关闭旧窗口
   *
   * changed=true 即使启用状态不变也会清空该轨未提交缓存，避免旧路由的尾帧进入新 AEC epoch
   */
  public func updateSourceActivity(
    systemEnabled: Bool,
    micEnabled: Bool,
    systemChanged: Bool,
    micChanged: Bool,
    logicalTimeSeconds: Double
  ) {
    let boundary = logicalFrame(logicalTimeSeconds)
    queue.async { [weak self] in
      guard let self, !self.finished else { return }
      do {
        /**
         * 墙钟一定可能领先最后一个 Core Audio callback。只提交已经进入三条 timeline 的
         * PCM；否则下一帧跨过墙钟边界的有效尾部会被提前写成静音并永久丢弃
         */
        let availableBoundary = min(boundary, self.oldRouteLatestBufferedEnd)
        try self.processThrough(availableBoundary)
        if systemChanged || self.systemEnabled != systemEnabled {
          self.systemTimeline.reset(at: max(boundary, self.nextOutputFrame))
          self.systemNormalizer.resetInputFormat()
        }
        if micChanged || self.micEnabled != micEnabled {
          let resetFrame = max(boundary, self.nextOutputFrame)
          self.fallbackMicTimeline.reset(at: resetFrame)
          self.preferredMicTimeline.reset(at: resetFrame)
          self.fallbackMicNormalizer.resetInputFormat()
          self.preferredMicNormalizer.resetInputFormat()
        }
        self.systemEnabled = systemEnabled
        self.micEnabled = micEnabled
        self.preferredMicEnabled = self.expectsPreferredMic && systemEnabled && micEnabled
        self.everMixedMic = self.everMixedMic || micEnabled
        self.logger(
          "audio realtime delivery route boundary frame=\(boundary) "
            + "committedThrough=\(availableBoundary) "
            + "system=\(systemEnabled) mic=\(micEnabled) "
            + "systemChanged=\(systemChanged) micChanged=\(micChanged)"
        )
      }
      catch {
        self.processingError = self.processingError ?? error
      }
    }
  }

  /** 排空真实输入并关闭 M4A；断流后的墙钟尾巴只记账，不在 stop 同步补零；调用幂等 */
  public func finish(logicalDurationSeconds: Double) -> RealtimeDeliveryResult {
    queue.sync {
      if !finished {
        finished = true
        if processingError == nil, acceptedInputBuffers > 0 {
          do {
            let logicalDurationFrame = logicalFrame(logicalDurationSeconds)
            let maximumAvailableTimelineFrame = [
              nextOutputFrame,
              systemTimeline.endFrame,
              fallbackMicTimeline.endFrame,
              preferredMicTimeline.endFrame,
            ].max() ?? nextOutputFrame
            let renderEndFrame = max(
              maximumAvailableTimelineFrame,
              min(
                logicalDurationFrame,
                maximumAvailableTimelineFrame + Int64(Policy.maximumTrailingSynthesisFrames)
              )
            )
            omittedTrailingFrames = max(0, logicalDurationFrame - renderEndFrame)
            try processThrough(renderEndFrame)
          }
          catch {
            processingError = error
          }
        }
        outputFile = nil
        systemNormalizer.resetInputFormat()
        fallbackMicNormalizer.resetInputFormat()
        preferredMicNormalizer.resetInputFormat()
      }

      if let processingError {
        logger("audio realtime delivery failed: \(processingError)")
        return RealtimeDeliveryResult(
          filePath: nil,
          frameCount: outputFrameCount,
          omittedTrailingFrames: omittedTrailingFrames,
          droppedInputBuffers: droppedInputBuffers,
          errorDescription: String(describing: processingError)
        )
      }
      guard acceptedInputBuffers > 0, outputFrameCount > 0 else {
        return RealtimeDeliveryResult(
          filePath: nil,
          frameCount: 0,
          omittedTrailingFrames: omittedTrailingFrames,
          droppedInputBuffers: droppedInputBuffers,
          errorDescription: "realtime delivery produced no frames"
        )
      }

      logger(
        "audio realtime delivery finalized frames=\(outputFrameCount) "
          + "omittedTrailingFrames=\(omittedTrailingFrames) "
          + "droppedInputs=\(droppedInputBuffers) path=\(outputURL.path)"
      )
      return RealtimeDeliveryResult(
        filePath: outputURL.path,
        frameCount: outputFrameCount,
        omittedTrailingFrames: omittedTrailingFrames,
        droppedInputBuffers: droppedInputBuffers,
        errorDescription: nil
      )
    }
  }

  public func discardOutput() {
    queue.sync {
      outputFile = nil
      try? FileManager.default.removeItem(at: outputURL)
    }
  }

  private func enqueue(
    _ buffer: AVAudioPCMBuffer,
    kind: InputKind,
    logicalTimeSeconds: Double
  ) {
    guard reservePendingBuffer() else { return }
    queue.async { [weak self] in
      guard let self else { return }
      defer { self.releasePendingBuffer() }
      guard !self.finished, self.processingError == nil else { return }
      do {
        let normalizer = switch kind {
        case .system: self.systemNormalizer
        case .fallbackMic: self.fallbackMicNormalizer
        case .preferredMic: self.preferredMicNormalizer
        }
        let normalized = try normalizer.normalize(buffer)
        self.acceptedInputBuffers += 1
        let startFrame = logicalFrame(logicalTimeSeconds)
        switch kind {
        case .system:
          try self.systemTimeline.append(normalized, startFrame: startFrame)
        case .fallbackMic:
          try self.fallbackMicTimeline.append(normalized, startFrame: startFrame)
        case .preferredMic:
          try self.preferredMicTimeline.append(normalized, startFrame: startFrame)
        }
        try self.processAvailable()
      }
      catch {
        self.processingError = error
      }
    }
  }

  private func processAvailable() throws {
    let activeEnds = [
      systemEnabled ? systemTimeline.endFrame : nil,
      micEnabled ? fallbackMicTimeline.endFrame : nil,
    ].compactMap { $0 }
    guard let latestActiveEnd = activeEnds.max() else { return }

    var readyFrame = latestActiveEnd
    if systemEnabled {
      readyFrame = min(
        readyFrame,
        max(systemTimeline.endFrame, latestActiveEnd - Int64(Policy.maximumSourceWaitFrames))
      )
    }
    if micEnabled {
      let preferredReady = preferredMicEnabled ? preferredMicTimeline.endFrame : 0
      let micReady = max(
        preferredReady,
        fallbackMicTimeline.endFrame - Int64(preferredMicEnabled ? Policy.maximumSourceWaitFrames : 0)
      )
      readyFrame = min(
        readyFrame,
        max(micReady, latestActiveEnd - Int64(Policy.maximumSourceWaitFrames))
      )
    }

    while readyFrame - nextOutputFrame >= Int64(Policy.outputChunkFrames) {
      try writeMixed(frameCount: Policy.outputChunkFrames)
    }
  }

  private func processThrough(_ finalFrame: Int64) throws {
    guard finalFrame > nextOutputFrame else { return }
    while nextOutputFrame < finalFrame {
      let count = Int(min(Int64(Policy.outputChunkFrames), finalFrame - nextOutputFrame))
      try writeMixed(frameCount: count)
    }
  }

  /** 更新前仍启用的路由已经缓冲到哪里；空 timeline 的 reset base 不能冒充真实输入 */
  private var oldRouteLatestBufferedEnd: Int64 {
    var ends = [nextOutputFrame]
    if systemEnabled, let end = systemTimeline.bufferedEndFrame {
      ends.append(end)
    }
    if micEnabled {
      if let end = fallbackMicTimeline.bufferedEndFrame {
        ends.append(end)
      }
      if preferredMicEnabled, let end = preferredMicTimeline.bufferedEndFrame {
        ends.append(end)
      }
    }
    return ends.max() ?? nextOutputFrame
  }

  private func writeMixed(frameCount: Int) throws {
    let startFrame = nextOutputFrame
    let system = systemEnabled
      ? systemTimeline.samples(startingAt: startFrame, count: frameCount)
      : [Float](repeating: 0, count: frameCount)
    let fallbackMic = micEnabled
      ? fallbackMicTimeline.samples(startingAt: startFrame, count: frameCount)
      : [Float](repeating: 0, count: frameCount)
    let usePreferred = micEnabled
      && expectsPreferredMic
      && preferredMicEnabled
      && preferredMicTimeline.availableSampleCount(startingAt: startFrame, count: frameCount) == frameCount
    let mic = usePreferred
      ? preferredMicTimeline.samples(startingAt: startFrame, count: frameCount)
      : fallbackMic

    let format = systemNormalizer.outputFormat
    guard let mixed = AVAudioPCMBuffer(
      pcmFormat: format,
      frameCapacity: AVAudioFrameCount(frameCount)
    ), let output = mixed.floatChannelData?[0] else {
      throw PCMNormalizationError.conversion("cannot allocate realtime delivery mix buffer")
    }
    mixed.frameLength = AVAudioFrameCount(frameCount)
    let applyLimiter = everMixedMic
    let releaseStep = Float(1 - exp(-1 / (Double(AUDIO_PROCESSING_SAMPLE_RATE) * Policy.limiterReleaseSeconds)))
    for index in 0..<frameCount {
      let sum = (system[index].isFinite ? system[index] : 0)
        + (mic[index].isFinite ? mic[index] : 0)
      if applyLimiter {
        let magnitude = abs(sum)
        if magnitude * limiterGain > Policy.limiterCeiling, magnitude > 0 {
          limiterGain = Policy.limiterCeiling / magnitude
        }
        else {
          limiterGain += (1 - limiterGain) * releaseStep
        }
      }
      output[index] = max(-Policy.limiterCeiling, min(Policy.limiterCeiling, sum * limiterGain))
    }

    if outputFile == nil {
      outputFile = try AVAudioFile(
        forWriting: outputURL,
        settings: outputSettings,
        commonFormat: .pcmFormatFloat32,
        interleaved: false
      )
    }
    try outputFile?.write(from: mixed)
    outputFrameCount += Int64(frameCount)
    nextOutputFrame += Int64(frameCount)
    systemTimeline.discard(before: nextOutputFrame)
    fallbackMicTimeline.discard(before: nextOutputFrame)
    preferredMicTimeline.discard(before: nextOutputFrame)
  }

  private func reservePendingBuffer() -> Bool {
    pendingLock.lock()
    defer { pendingLock.unlock() }
    guard pendingBuffers < Policy.maximumPendingBuffers else {
      droppedInputBuffers += 1
      if !backpressureLogged {
        backpressureLogged = true
        logger(
          "audio realtime delivery queue exceeded \(Policy.maximumPendingBuffers) buffers; "
            + "legacy recovery path will remain available"
        )
      }
      return false
    }
    pendingBuffers += 1
    return true
  }

  private func releasePendingBuffer() {
    pendingLock.lock()
    pendingBuffers = max(0, pendingBuffers - 1)
    pendingLock.unlock()
  }

  private func recordDroppedInput(_ detail: String) {
    pendingLock.lock()
    droppedInputBuffers += 1
    let shouldLog = !backpressureLogged
    backpressureLogged = true
    pendingLock.unlock()
    if shouldLog {
      logger("audio realtime delivery input dropped: \(detail)")
    }
  }

  private enum InputKind {
    case system
    case fallbackMic
    case preferredMic
  }
}

/** 连续逻辑帧窗口；已提交帧会及时丢弃，内存只与跨轨等待窗口相关 */
private struct DeliveryTimeline {
  private var storage: [Float] = []
  private(set) var baseFrame: Int64 = 0

  var endFrame: Int64 { baseFrame + Int64(storage.count) }
  var bufferedEndFrame: Int64? { storage.isEmpty ? nil : endFrame }

  mutating func append(_ buffer: AVAudioPCMBuffer, startFrame: Int64) throws {
    guard buffer.format.commonFormat == .pcmFormatFloat32,
          buffer.format.channelCount == 1,
          !buffer.format.isInterleaved,
          let samples = buffer.floatChannelData?[0]
    else {
      throw PCMNormalizationError.conversion("realtime delivery input is not normalized mono Float32")
    }
    if startFrame > endFrame {
      storage.append(contentsOf: repeatElement(0, count: Int(startFrame - endFrame)))
    }
    let skipped = max(0, Int(endFrame - startFrame))
    let frameCount = Int(buffer.frameLength)
    guard skipped < frameCount else { return }
    storage.reserveCapacity(storage.count + frameCount - skipped)
    for index in skipped..<frameCount {
      storage.append(samples[index].isFinite ? samples[index] : 0)
    }
  }

  func samples(startingAt startFrame: Int64, count: Int) -> [Float] {
    var result = [Float](repeating: 0, count: count)
    let readableStart = max(startFrame, baseFrame)
    let readableEnd = min(startFrame + Int64(count), endFrame)
    guard readableEnd > readableStart else { return result }
    let sourceOffset = Int(readableStart - baseFrame)
    let destinationOffset = Int(readableStart - startFrame)
    let readableCount = Int(readableEnd - readableStart)
    result.withUnsafeMutableBufferPointer { destination in
      storage.withUnsafeBufferPointer { source in
        destination.baseAddress?.advanced(by: destinationOffset).update(
          from: source.baseAddress!.advanced(by: sourceOffset),
          count: readableCount
        )
      }
    }
    return result
  }

  func availableSampleCount(startingAt startFrame: Int64, count: Int) -> Int {
    let readableStart = max(startFrame, baseFrame)
    let readableEnd = min(startFrame + Int64(count), endFrame)
    return max(0, Int(readableEnd - readableStart))
  }

  mutating func discard(before frame: Int64) {
    let count = min(storage.count, max(0, Int(frame - baseFrame)))
    if count > 0 {
      storage.removeFirst(count)
      baseFrame += Int64(count)
    }
    if storage.isEmpty, baseFrame < frame {
      baseFrame = frame
    }
  }

  mutating func reset(at frame: Int64) {
    storage.removeAll(keepingCapacity: true)
    baseFrame = frame
  }
}

private func logicalFrame(_ seconds: Double) -> Int64 {
  guard seconds.isFinite, seconds > 0 else { return 0 }
  return Int64((seconds * Double(AUDIO_PROCESSING_SAMPLE_RATE)).rounded())
}

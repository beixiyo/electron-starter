// 在录音期间持续消费 mic/reference，在线生成 AEC3 clean sidecar

import AVFoundation
import CoreMedia
import Foundation

public struct RealtimeEchoResult: Sendable {
  public let cleanFileURL: URL
  public let canPromote: Bool
  public let inputSamples: Int64
  public let outputSamples: Int64
  public let processedFrames: Int
  public let referenceSubmissions: Int
  public let missingReferenceSamples: Int64
  public let droppedSubmissions: Int
  public let implementationVersion: String?
  public let meanFrameProcessingMS: Double
  public let p95FrameProcessingMS: Double
  public let delayMS: Int
  public let delayCorrelation: Double?
  public let errorDescription: String?
}

/**
 * 在线 AEC3 会话
 *
 * 采集回调只负责复制输入并向有界队列投递；所有归一化、时间轴配对、AEC3 和文件写入均在
 * 私有串行队列上执行。reference 暂缺的区间按静音处理并保留诊断计数；队列溢出、处理异常、
 * 参考流完全缺失、参考流与 capture 无重叠或长度不一致时，调用方只能保留 raw sidecar，
 * 不能提升这份 clean 文件
 */
public final class RealtimeEchoProcessor: @unchecked Sendable {
  private enum Policy {
    static let frameSamples = AUDIO_PROCESSING_FRAME_SAMPLES
    static let outputProcessingChunkSamples = 4_800
    static let maximumReferenceWaitFrames: Int64 = 48_000
    static let delayUpdateIntervalFrames: Int64 = 48_000
    static let minimumDelayObservationFrames: Int64 = 96_000
    static let maximumDelayEnvelopeFrames = 3_000
    static let delayEnvelopeTrimBatchFrames = 100
    static let maximumPendingSubmissions = 512
    static let metricsSampleCapacity = 256
  }

  private let options: AudioProcessingOptions
  private let cleanFileURL: URL
  private let logger: (String) -> Void
  private let processingQueue = DispatchQueue(
    label: "audio-processing-realtime",
    qos: .userInitiated
  )
  private let pendingSlots = DispatchSemaphore(value: Policy.maximumPendingSubmissions)
  private let stateLock = NSLock()

  private var acceptingSubmissions = true
  private var finished = false
  private var result: RealtimeEchoResult?
  private var submissionError: String?

  // The following fields are owned by processingQueue after init.
  private var captureNormalizer: PCMBufferNormalizer
  private var referenceNormalizer: PCMBufferNormalizer
  private var captureTimeline = SampleTimeline()
  private var referenceTimeline = SampleTimeline()
  private var cleanFile: AVAudioFile?
  private var outputFormat: AVAudioFormat
  private var processor: WebRTCAPMProcessor?
  private var postProcessor: MicrophoneSignalProcessor
  private var nextCaptureFrame: Int64 = 0
  private var currentDelayMS: Int
  private var lastDelayUpdateFrame: Int64 = 0
  private var captureEnvelope: [Float] = []
  private var referenceEnvelope: [Float] = []
  private var pendingCleanSamples: [Float] = []
  private var processingDurationsMS: [Double] = []
  private var processingDurationSumMS = 0.0
  private var totalProcessedFrames = 0
  private var inputSamples: Int64 = 0
  private var outputSamples: Int64 = 0
  private var referenceSubmissions = 0
  private var missingReferenceSamples: Int64 = 0
  private var droppedSubmissions = 0
  private var sawCapture = false
  private var sawReference = false
  private var hasProcessedReferenceSamples = false
  private var processingError: String?

  public init(
    options: AudioProcessingOptions,
    cleanFileURL: URL,
    logger: @escaping (String) -> Void = { _ in }
  ) throws {
    guard options.processor == .webrtcAec3 else {
      throw AudioProcessingConfigurationError.invalidValue(
        "RealtimeEchoProcessor requires processor=webrtcAec3"
      )
    }
    try options.validate()
    self.options = options
    self.cleanFileURL = cleanFileURL
    self.logger = logger
    self.captureNormalizer = try PCMBufferNormalizer(downmixMode: .average)
    self.referenceNormalizer = try PCMBufferNormalizer(downmixMode: .average)
    self.outputFormat = captureNormalizer.outputFormat
    self.currentDelayMS = max(0, min(AUDIO_PROCESSING_MAX_DELAY_MS, options.fixedDelayMS))
    self.postProcessor = MicrophoneSignalProcessor(logger: logger)
    self.processor = try WebRTCAPMProcessor(options: options)
    try? FileManager.default.removeItem(at: cleanFileURL)
  }

  /** 向有界队列投递一块 capture；返回 false 表示本块不可信，调用方必须保留 raw。 */
  @discardableResult
  public func submitCapture(
    _ buffer: AVAudioPCMBuffer,
    logicalTimeSeconds: Double
  ) -> Bool {
    guard reserveSubmissionSlot() else { return false }
    guard let copied = PCMBufferNormalizer.copy(buffer) else {
      pendingSlots.signal()
      markSubmissionFailure("capture PCM copy failed")
      return false
    }
    stateLock.lock()
    guard acceptingSubmissions else {
      stateLock.unlock()
      pendingSlots.signal()
      return false
    }
    processingQueue.async { [weak self] in
      defer { self?.pendingSlots.signal() }
      self?.consumeCapture(copied, logicalTimeSeconds: logicalTimeSeconds)
    }
    stateLock.unlock()
    return true
  }

  /** 向有界队列投递一块 reference；返回 false 表示本块不可信。 */
  @discardableResult
  public func submitReference(
    _ sampleBuffer: CMSampleBuffer,
    logicalTimeSeconds: Double
  ) -> Bool {
    guard reserveSubmissionSlot() else { return false }
    guard let copied = PCMBufferNormalizer.copy(sampleBuffer) else {
      pendingSlots.signal()
      markSubmissionFailure("reference PCM copy failed")
      return false
    }
    stateLock.lock()
    guard acceptingSubmissions else {
      stateLock.unlock()
      pendingSlots.signal()
      return false
    }
    processingQueue.async { [weak self] in
      defer { self?.pendingSlots.signal() }
      self?.consumeReference(copied, logicalTimeSeconds: logicalTimeSeconds)
    }
    stateLock.unlock()
    return true
  }

  /** 供原生 PCM source 和行为测试直接投递 reference。 */
  @discardableResult
  public func submitReference(
    _ buffer: AVAudioPCMBuffer,
    logicalTimeSeconds: Double
  ) -> Bool {
    guard reserveSubmissionSlot() else { return false }
    guard let copied = PCMBufferNormalizer.copy(buffer) else {
      pendingSlots.signal()
      markSubmissionFailure("reference PCM copy failed")
      return false
    }
    stateLock.lock()
    guard acceptingSubmissions else {
      stateLock.unlock()
      pendingSlots.signal()
      return false
    }
    processingQueue.async { [weak self] in
      defer { self?.pendingSlots.signal() }
      self?.consumeReference(copied, logicalTimeSeconds: logicalTimeSeconds)
    }
    stateLock.unlock()
    return true
  }

  /**
   * 排空已提交的工作并关闭 clean 临时文件。处理只覆盖尚未消费的队列尾部，不重新读取整场录音
   * 该方法只应在 stop 已排空采集队列后调用
   */
  public func finish() -> RealtimeEchoResult {
    stateLock.lock()
    if let result {
      stateLock.unlock()
      return result
    }
    if finished {
      stateLock.unlock()
      processingQueue.sync {}
      return stateLock.withLock {
        result ?? makeUnavailableResult(error: "realtime audio processing did not finish")
      }
    }
    acceptingSubmissions = false
    finished = true

    let completion = DispatchSemaphore(value: 0)
    processingQueue.async { [weak self] in
      guard let self else {
        completion.signal()
        return
      }
      self.finishOnProcessingQueue()
      completion.signal()
    }
    stateLock.unlock()
    completion.wait()

    stateLock.lock()
    let final = result ?? makeUnavailableResult(error: "realtime audio processing did not finish")
    stateLock.unlock()
    return final
  }

  /** 启动失败或录音取消时关闭并删除未提升的 clean 临时文件。 */
  public func cancel() {
    stateLock.lock()
    acceptingSubmissions = false
    finished = true
    stateLock.unlock()
    processingQueue.sync {
      cleanFile = nil
      try? FileManager.default.removeItem(at: cleanFileURL)
    }
  }

  private func reserveSubmissionSlot() -> Bool {
    stateLock.lock()
    let accepting = acceptingSubmissions
    stateLock.unlock()
    guard accepting else { return false }
    guard pendingSlots.wait(timeout: .now()) == .success else {
      markSubmissionFailure("realtime processing queue backpressure dropped audio")
      stateLock.lock()
      droppedSubmissions += 1
      stateLock.unlock()
      return false
    }
    return true
  }

  private func markSubmissionFailure(_ message: String) {
    stateLock.lock()
    if submissionError == nil {
      submissionError = message
    }
    stateLock.unlock()
    logger("audio processing: \(message)")
  }

  private func consumeCapture(_ buffer: AVAudioPCMBuffer, logicalTimeSeconds: Double) {
    guard processingError == nil else { return }
    do {
      let normalized = try captureNormalizer.normalize(buffer)
      let startFrame = logicalStartFrame(logicalTimeSeconds)
      try captureTimeline.append(normalized, startFrame: startFrame)
      sawCapture = true
      try processAvailable(finishing: false)
    }
    catch {
      recordProcessingError("capture processing failed: \(error)")
    }
  }

  private func consumeReference(_ buffer: AVAudioPCMBuffer, logicalTimeSeconds: Double) {
    guard processingError == nil else { return }
    do {
      let normalized = try referenceNormalizer.normalize(buffer)
      let startFrame = logicalStartFrame(logicalTimeSeconds)
      try referenceTimeline.append(normalized, startFrame: startFrame)
      referenceSubmissions += 1
      sawReference = true
      try processAvailable(finishing: false)
    }
    catch {
      recordProcessingError("reference processing failed: \(error)")
    }
  }

  private func finishOnProcessingQueue() {
    if processingError == nil {
      do {
        try processAvailable(finishing: true)
        try flushPendingCleanSamples()
      }
      catch {
        recordProcessingError("final audio processing failed: \(error)")
      }
    }
    cleanFile = nil

    let submissionError = stateLock.withLock { self.submissionError }
    let droppedSubmissions = stateLock.withLock { self.droppedSubmissions }
    let failure = processingError ?? submissionError
    let readableLength: AVAudioFramePosition? = {
      guard FileManager.default.fileExists(atPath: cleanFileURL.path),
            let readable = try? AVAudioFile(forReading: cleanFileURL) else { return nil }
      return readable.length
    }()
    let lengthMatches = readableLength == outputSamples && outputSamples == inputSamples
    let errorDescription: String? = if let failure {
      failure
    }
    else if !sawCapture {
      "no capture samples were processed"
    }
    else if !sawReference {
      "reference stream was unavailable"
    }
    else if !hasProcessedReferenceSamples {
      "reference stream had no samples aligned with capture"
    }
    else if droppedSubmissions > 0 {
      "realtime processing dropped \(droppedSubmissions) submission(s)"
    }
    else if !lengthMatches {
      "clean output length does not match capture input"
    }
    else {
      nil
    }
    let canPromote = errorDescription == nil
      && sawCapture
      && sawReference
      && hasProcessedReferenceSamples
      && outputSamples == inputSamples
      && readableLength == outputSamples

    let recentFrameCount = processingDurationsMS.count
    let p95 = percentile95(processingDurationsMS)
    let final = RealtimeEchoResult(
      cleanFileURL: cleanFileURL,
      canPromote: canPromote,
      inputSamples: inputSamples,
      outputSamples: outputSamples,
      processedFrames: totalProcessedFrames,
      referenceSubmissions: referenceSubmissions,
      missingReferenceSamples: missingReferenceSamples,
      droppedSubmissions: droppedSubmissions,
      implementationVersion: processor?.implementationVersion,
      meanFrameProcessingMS: totalProcessedFrames > 0
        ? processingDurationSumMS / Double(totalProcessedFrames)
        : 0,
      p95FrameProcessingMS: p95,
      delayMS: currentDelayMS,
      delayCorrelation: latestDelayCorrelation,
      errorDescription: errorDescription
    )
    stateLock.withLock {
      result = final
    }
    logger(
      "audio processing finished: promote=\(canPromote) input=\(inputSamples) output=\(outputSamples) "
        + "frames=\(totalProcessedFrames) recentTimingSamples=\(recentFrameCount) delay=\(currentDelayMS)ms "
        + "missingReference=\(missingReferenceSamples) dropped=\(droppedSubmissions) "
        + "error=\(errorDescription ?? "none")"
    )
  }

  private var latestDelayCorrelation: Double?

  private func processAvailable(finishing: Bool) throws {
    while captureTimeline.endFrame > nextCaptureFrame {
      let remainingCapture = captureTimeline.endFrame - nextCaptureFrame
      guard finishing || remainingCapture >= Int64(Policy.frameSamples) else { return }

      let validCaptureSamples = Int(min(Int64(Policy.frameSamples), remainingCapture))
      let referenceOffsetFrames: Int64 = 0
      let referenceStartFrame = nextCaptureFrame - referenceOffsetFrames
      let referenceEndFrame = referenceStartFrame + Int64(Policy.frameSamples)
      let referenceIsReady = referenceEndFrame <= 0
        || referenceTimeline.endFrame >= referenceEndFrame
      let bufferedCaptureFrames = captureTimeline.endFrame - nextCaptureFrame
      guard finishing
        || referenceIsReady
        || bufferedCaptureFrames > Policy.maximumReferenceWaitFrames else {
        return
      }

      var capture = captureTimeline.samples(
        startingAt: nextCaptureFrame,
        count: Policy.frameSamples
      )
      var render = referenceTimeline.samples(
        startingAt: referenceStartFrame,
        count: Policy.frameSamples
      )
      let availableReferenceSamples = referenceTimeline.availableSampleCount(
        startingAt: referenceStartFrame,
        count: Policy.frameSamples
      )
      let unavailableReferenceSamples = Policy.frameSamples - availableReferenceSamples
      missingReferenceSamples += Int64(unavailableReferenceSamples)
      if availableReferenceSamples > 0 {
        hasProcessedReferenceSamples = true
      }
      captureEnvelope.append(rootMeanSquare(capture))
      referenceEnvelope.append(rootMeanSquare(render))
      trimDelayEnvelopesIfNeeded()
      updateDelayIfNeeded()

      var clean = [Float](repeating: 0, count: Policy.frameSamples)
      let startedAt = DispatchTime.now().uptimeNanoseconds
      guard let processor else {
        throw WebRTCAPMError.processingFailed("processor is unavailable")
      }
      try processor.processFrame(
        render: &render,
        capture: &capture,
        delayMS: currentDelayMS,
        clean: &clean
      )
      let elapsedMS = Double(DispatchTime.now().uptimeNanoseconds - startedAt) / 1_000_000
      processingDurationsMS.append(elapsedMS)
      if processingDurationsMS.count > Policy.metricsSampleCapacity {
        processingDurationsMS.removeFirst()
      }
      processingDurationSumMS += elapsedMS
      totalProcessedFrames += 1
      try appendClean(clean, validSamples: validCaptureSamples)

      inputSamples += Int64(validCaptureSamples)
      nextCaptureFrame += Int64(validCaptureSamples)
      captureTimeline.discard(before: nextCaptureFrame)
      referenceTimeline.discard(before: max(0, nextCaptureFrame - referenceOffsetFrames - 48_000))
    }
  }

  private func appendClean(_ samples: [Float], validSamples: Int) throws {
    guard validSamples > 0,
          samples.count >= validSamples,
          samples.prefix(validSamples).allSatisfy(\.isFinite) else {
      throw WebRTCAPMError.processingFailed("AEC3 produced invalid samples")
    }
    pendingCleanSamples.append(contentsOf: samples.prefix(validSamples))
    while pendingCleanSamples.count >= Policy.outputProcessingChunkSamples {
      try writeProcessedSamples(count: Policy.outputProcessingChunkSamples)
    }
  }

  private func flushPendingCleanSamples() throws {
    guard !pendingCleanSamples.isEmpty else { return }
    try writeProcessedSamples(count: pendingCleanSamples.count)
  }

  private func writeProcessedSamples(count: Int) throws {
    guard count > 0,
          pendingCleanSamples.count >= count,
          let buffer = AVAudioPCMBuffer(
            pcmFormat: outputFormat,
            frameCapacity: AVAudioFrameCount(count)
          ),
          let target = buffer.floatChannelData?[0] else {
      throw PCMNormalizationError.conversion("cannot allocate clean output buffer")
    }
    buffer.frameLength = AVAudioFrameCount(count)
    pendingCleanSamples.withUnsafeBufferPointer { source in
      target.update(from: source.baseAddress!, count: count)
    }
    postProcessor.process(buffer)

    if cleanFile == nil {
      cleanFile = try AVAudioFile(
        forWriting: cleanFileURL,
        settings: outputFormat.settings,
        commonFormat: .pcmFormatFloat32,
        interleaved: false
      )
    }
    try cleanFile?.write(from: buffer)
    outputSamples += Int64(count)
    pendingCleanSamples.removeFirst(count)
  }

  private func updateDelayIfNeeded() {
    guard options.delayMode != .fixed,
          inputSamples - lastDelayUpdateFrame >= Policy.delayUpdateIntervalFrames,
          inputSamples >= Policy.minimumDelayObservationFrames else { return }
    lastDelayUpdateFrame = inputSamples
    let decision = AudioDelayEstimator.decide(
      captureEnvelope: captureEnvelope,
      referenceEnvelope: referenceEnvelope,
      options: options
    )
    guard !decision.usedFallback else { return }
    latestDelayCorrelation = decision.correlation
    if decision.delayMS != currentDelayMS {
      logger(
        "audio processing delay updated \(currentDelayMS)ms -> \(decision.delayMS)ms "
          + "correlation=\(decision.correlation.map { String(format: "%.4f", $0) } ?? "n/a")"
      )
      currentDelayMS = decision.delayMS
    }
    if decision.searchBoundaryHit {
      logger("audio processing delay search reached \(AUDIO_PROCESSING_MAX_DELAY_MS)ms boundary")
    }
  }

  private func trimDelayEnvelopesIfNeeded() {
    let excess = captureEnvelope.count - Policy.maximumDelayEnvelopeFrames
    guard excess >= Policy.delayEnvelopeTrimBatchFrames else { return }
    captureEnvelope.removeFirst(excess)
    referenceEnvelope.removeFirst(min(excess, referenceEnvelope.count))
  }

  private func logicalStartFrame(_ seconds: Double) -> Int64 {
    guard seconds.isFinite, seconds >= 0 else { return 0 }
    return Int64((seconds * Double(AUDIO_PROCESSING_SAMPLE_RATE)).rounded())
  }

  private func recordProcessingError(_ message: String) {
    if processingError == nil {
      processingError = message
      logger("audio processing: \(message)")
    }
  }

  private func makeUnavailableResult(error: String) -> RealtimeEchoResult {
    RealtimeEchoResult(
      cleanFileURL: cleanFileURL,
      canPromote: false,
      inputSamples: 0,
      outputSamples: 0,
      processedFrames: 0,
      referenceSubmissions: 0,
      missingReferenceSamples: 0,
      droppedSubmissions: 0,
      implementationVersion: nil,
      meanFrameProcessingMS: 0,
      p95FrameProcessingMS: 0,
      delayMS: currentDelayMS,
      delayCorrelation: nil,
      errorDescription: error
    )
  }
}

private struct SampleTimeline {
  private var storage: [Float] = []
  /** 与 storage 等长；补时间轴的零为 false，真实提交的样本为 true。 */
  private var availability: [Bool] = []
  private(set) var baseFrame: Int64 = 0

  var endFrame: Int64 { baseFrame + Int64(storage.count) }

  mutating func append(_ buffer: AVAudioPCMBuffer, startFrame: Int64) throws {
    guard buffer.format.commonFormat == .pcmFormatFloat32,
          buffer.format.channelCount == 1,
          !buffer.format.isInterleaved,
          let samples = buffer.floatChannelData?[0] else {
      throw PCMNormalizationError.invalidFormat("timeline expects mono non-interleaved Float32")
    }

    if startFrame > endFrame {
      let gapCount = Int(startFrame - endFrame)
      storage.append(contentsOf: repeatElement(0, count: gapCount))
      availability.append(contentsOf: repeatElement(false, count: gapCount))
    }
    let skipped = max(0, Int(endFrame - startFrame))
    let frameCount = Int(buffer.frameLength)
    guard skipped < frameCount else { return }
    storage.reserveCapacity(storage.count + frameCount - skipped)
    availability.reserveCapacity(availability.count + frameCount - skipped)
    for index in skipped..<frameCount {
      storage.append(samples[index].isFinite ? samples[index] : 0)
      availability.append(true)
    }
  }

  func samples(startingAt startFrame: Int64, count: Int) -> [Float] {
    var result = [Float](repeating: 0, count: count)
    guard count > 0 else { return result }
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
    guard readableEnd > readableStart else { return 0 }
    let sourceStart = Int(readableStart - baseFrame)
    let sourceEnd = Int(readableEnd - baseFrame)
    return availability[sourceStart..<sourceEnd].reduce(0) { count, available in
      count + (available ? 1 : 0)
    }
  }

  mutating func discard(before frame: Int64) {
    let discardCount = min(storage.count, max(0, Int(frame - baseFrame)))
    guard discardCount == storage.count || discardCount >= AUDIO_PROCESSING_SAMPLE_RATE else { return }
    storage.removeFirst(discardCount)
    availability.removeFirst(discardCount)
    baseFrame += Int64(discardCount)
  }
}

private func rootMeanSquare(_ samples: [Float]) -> Float {
  guard !samples.isEmpty else { return 0 }
  let sum = samples.reduce(0.0) { partial, sample in
    partial + Double(sample) * Double(sample)
  }
  return Float(sqrt(sum / Double(samples.count)))
}

private func percentile95(_ values: [Double]) -> Double {
  guard !values.isEmpty else { return 0 }
  let sorted = values.sorted()
  let index = min(sorted.count - 1, Int(ceil(Double(sorted.count) * 0.95)) - 1)
  return sorted[max(0, index)]
}

private extension NSLock {
  func withLock<T>(_ body: () throws -> T) rethrows -> T {
    lock()
    defer { unlock() }
    return try body()
  }
}

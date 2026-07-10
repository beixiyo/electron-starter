import AVFoundation
import Cocoa
import CoreAudio
import CoreGraphics
import CoreMedia
import ScreenCaptureKit

enum AudioCheckpointTrack {
  case system
  case mic
}

/**
 * 并行 checkpoint writer:主 writer 仍写原始长 M4A;这里额外每 ~5s finalize 一个小 M4A segment。
 * 突然断电时最多损失正在写的当前 segment,前面已 finalize 的 segments 可在下次启动合并恢复。
 */
final class AudioCheckpointWriter {
  private let segmentDir: URL
  private let systemSettings: [String: Any]
  private let systemSourceFormatHint: CMFormatDescription?
  private let micSettings: [String: Any]?
  private let micSourceFormatHint: CMFormatDescription?
  private let finishQueue = DispatchQueue(label: "audio-checkpoint-finish")
  private let finishStateLock = NSLock()

  private var writer: AVAssetWriter?
  private var systemInput: AVAssetWriterInput?
  private var micInput: AVAssetWriterInput?
  private var sessionStarted = false
  private var segmentStartedAt: Date?
  private var segmentIndex = 0
  private var disabled = false
  private var segmentFinishInFlight = false

  init(
    outputPath: String,
    systemSettings: [String: Any],
    systemSourceFormatHint: CMFormatDescription? = nil,
    micSettings: [String: Any]? = nil,
    micSourceFormatHint: CMFormatDescription? = nil
  ) {
    self.segmentDir = URL(fileURLWithPath: checkpointSegmentDirPath(for: outputPath), isDirectory: true)
    self.systemSettings = systemSettings
    self.systemSourceFormatHint = systemSourceFormatHint
    self.micSettings = micSettings
    self.micSourceFormatHint = micSourceFormatHint

    do {
      try FileManager.default.removeItem(at: segmentDir)
    }
    catch { /* missing dir is fine */ }

    do {
      try FileManager.default.createDirectory(at: segmentDir, withIntermediateDirectories: true)
      try writeActiveLock()
    }
    catch {
      disabled = true
      log("checkpoint disabled: \(error.localizedDescription)")
    }
  }

  func append(_ sampleBuffer: CMSampleBuffer, track: AudioCheckpointTrack) {
    guard !disabled else { return }

    do {
      if writer == nil {
        try startSegment()
      }
    }
    catch {
      disabled = true
      log("checkpoint start failed: \(describeError(error))")
      return
    }

    guard let writer, writer.status == .writing else { return }
    let input: AVAssetWriterInput?
    switch track {
    case .system:
      input = systemInput
    case .mic:
      input = micInput
    }
    guard let input, input.isReadyForMoreMediaData else { return }

    if !sessionStarted {
      writer.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
      sessionStarted = true
    }

    if !input.append(sampleBuffer) {
      log("checkpoint append failed: \(describeError(writer.error))")
      return
    }

    if let segmentStartedAt,
       Date().timeIntervalSince(segmentStartedAt) >= AUDIO_CHECKPOINT_INTERVAL {
      rotateCurrentSegmentIfPossible()
    }
  }

  func finish() {
    let currentWriter = detachCurrentSegment()
    finishQueue.sync {
      if let currentWriter {
        finishDetachedSegment(currentWriter)
      }
    }
    removeActiveLock()
  }

  func deleteAll() {
    finish()
    do {
      try FileManager.default.removeItem(at: segmentDir)
    }
    catch { /* already gone */ }
  }

  private func startSegment() throws {
    segmentIndex += 1
    let segmentURL = segmentDir.appendingPathComponent(String(format: "%06d.m4a", segmentIndex))
    try? FileManager.default.removeItem(at: segmentURL)

    let nextWriter = try AVAssetWriter(outputURL: segmentURL, fileType: .m4a)
    let nextSystemInput = AVAssetWriterInput(mediaType: .audio, outputSettings: systemSettings, sourceFormatHint: systemSourceFormatHint)
    nextSystemInput.expectsMediaDataInRealTime = true
    nextWriter.add(nextSystemInput)

    var nextMicInput: AVAssetWriterInput?
    if let micSettings {
      let input = AVAssetWriterInput(mediaType: .audio, outputSettings: micSettings, sourceFormatHint: micSourceFormatHint)
      input.expectsMediaDataInRealTime = true
      nextWriter.add(input)
      nextMicInput = input
    }

    nextWriter.startWriting()
    writer = nextWriter
    systemInput = nextSystemInput
    micInput = nextMicInput
    sessionStarted = false
    segmentStartedAt = Date()
  }

  private func rotateCurrentSegmentIfPossible() {
    guard writer != nil else { return }
    guard markSegmentFinishInFlight() else { return }

    guard let currentWriter = detachCurrentSegment() else {
      clearSegmentFinishInFlight()
      return
    }

    finishQueue.async {
      self.finishDetachedSegment(currentWriter)
      self.clearSegmentFinishInFlight()
    }
  }

  private func detachCurrentSegment() -> AVAssetWriter? {
    guard let currentWriter = writer else { return nil }
    systemInput?.markAsFinished()
    micInput?.markAsFinished()

    writer = nil
    systemInput = nil
    micInput = nil
    sessionStarted = false
    segmentStartedAt = nil

    return currentWriter
  }

  private func finishDetachedSegment(_ currentWriter: AVAssetWriter) {
    let semaphore = DispatchSemaphore(value: 0)
    currentWriter.finishWriting {
      semaphore.signal()
    }
    semaphore.wait()

    if currentWriter.status != .completed {
      log("checkpoint finish failed: status=\(currentWriter.status.rawValue) error=\(describeError(currentWriter.error))")
    }
  }

  private func markSegmentFinishInFlight() -> Bool {
    finishStateLock.lock()
    defer { finishStateLock.unlock() }

    if segmentFinishInFlight {
      return false
    }

    segmentFinishInFlight = true
    return true
  }

  private func clearSegmentFinishInFlight() {
    finishStateLock.lock()
    segmentFinishInFlight = false
    finishStateLock.unlock()
  }

  private func writeActiveLock() throws {
    let json = "{\"pid\":\(getpid()),\"createdAt\":\(Int(Date().timeIntervalSince1970 * 1000))}"
    try json.write(to: activeLockURL(), atomically: true, encoding: .utf8)
  }

  private func removeActiveLock() {
    try? FileManager.default.removeItem(at: activeLockURL())
  }

  private func activeLockURL() -> URL {
    segmentDir.appendingPathComponent("active.json")
  }
}

func checkpointSegmentDirPath(for outputPath: String) -> String {
  "\(outputPath).segments"
}

// 用 ScreenCaptureKit 录制全系统音频，并管理 writer、checkpoint 与断流看门狗

import AVFoundation
import Cocoa
import CoreAudio
import CoreGraphics
import CoreMedia
import ScreenCaptureKit

// MARK: - SCK 会议引擎（全系统音频 + mic，依赖屏幕录制权限）

class Recorder: NSObject, SCStreamOutput {
  private var stream: SCStream?
  private var writer: AVAssetWriter?
  private var checkpointWriter: AudioCheckpointWriter?
  private var systemInput: AVAssetWriterInput?
  private var micInput: AVAssetWriterInput? // macOS 15.0+ only
  private var hasMic = false
  private var paused = false
  private var outputPath: String = ""
  private var startTime: Date?
  private var totalPausedDuration: TimeInterval = 0
  private var pausedAt: Date?
  private var sessionStarted = false
  /** 真实落盘样本数(append 成功才计):sessionStarted 只代表首帧到达,零 append 的空文件必须靠它拦截 */
  private var appendedSampleCount = 0
  private var micAppendedSampleCount = 0
  private var firstSampleWatchdogToken = UUID()
  private var firstSampleErrorEmitted = false
  private var sampleGapWatchdogToken = UUID()
  private var sampleGapErrorEmitted = false
  private var lastSampleAt: Date?
  /** 样本回调与 watchdog 检查共用此串行队列,避免跨线程裸读 sessionStarted / lastSampleAt */
  private let sampleQueue = DispatchQueue(label: "audio-recorder", qos: .userInitiated)

  @discardableResult
  func start(outputPath: String) async -> Bool {
    guard stream == nil else {
      output(error: "already_recording")
      return false
    }

    self.outputPath = outputPath

    do {
      let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
      guard let display = content.displays.first else {
        output(error: "no_display")
        return false
      }

      let config = SCStreamConfiguration()
      config.capturesAudio = true
      config.excludesCurrentProcessAudio = true
      config.sampleRate = 48000
      config.channelCount = 2
      // 不需要视频，设最小尺寸
      config.width = 2
      config.height = 2

      if #available(macOS 15.0, *) {
        config.captureMicrophone = true
        hasMic = true
      }

      let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
      let scStream = SCStream(filter: filter, configuration: config, delegate: nil)

      try setupWriter(outputPath: outputPath)

      try scStream.addStreamOutput(self, type: .audio, sampleHandlerQueue: sampleQueue)
      if #available(macOS 15.0, *) {
        try scStream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: sampleQueue)
      }

      try await scStream.startCapture()
      self.stream = scStream
      self.startTime = Date()
      startFirstSampleWatchdog()
      startSampleGapWatchdog()

      log("SCK start: hasMic=\(hasMic) devices: \(describeDefaultAudioDevices())")
      output(status: "recording", path: outputPath)
      return true
    }
    catch let error as NSError {
      if isStorageInsufficientError(error) {
        output(error: "storage_insufficient", detail: describeError(error))
      }
      else if error.domain == "com.apple.ScreenCaptureKit"
        || error.localizedDescription.contains("permission") {
        output(error: "permission_denied")
      }
      else {
        output(error: error.localizedDescription)
      }
      cleanup()
      return false
    }
  }

  func pause() {
    guard stream != nil, !paused else { return }
    paused = true
    pausedAt = Date()
    output(status: "paused", path: outputPath)
  }

  func resume() {
    guard stream != nil, paused else { return }
    if let pa = pausedAt {
      totalPausedDuration += Date().timeIntervalSince(pa)
      pausedAt = nil
    }
    paused = false
    lastSampleAt = Date()
    if !sessionStarted {
      startFirstSampleWatchdog()
    }
    startSampleGapWatchdog()
    output(status: "recording", path: outputPath)
  }

  func stop(handoffId: Int? = nil) async {
    guard let scStream = stream else {
      output(terminalError: "not_recording", path: outputPath, handoffId: handoffId)
      return
    }
    firstSampleWatchdogToken = UUID()
    sampleGapWatchdogToken = UUID()

    if paused, let pa = pausedAt {
      totalPausedDuration += Date().timeIntervalSince(pa)
    }

    do { try await scStream.stopCapture() }
    catch { log("stop capture error: \(error)") }

    /** 对齐 tap 引擎:等待 stopCapture 之后已入队的 sample 回调排空,再 finalize writers */
    sampleQueue.sync {}

    systemInput?.markAsFinished()
    micInput?.markAsFinished()

    if let writer = writer, writer.status == .writing {
      await writer.finishWriting()
    }
    let checkpoints = checkpointWriter
    checkpoints?.finish()
    let writerStatus = writer?.status
    let writerError = describeError(writer?.error)
    let hasStorageWriteError = isStorageInsufficientError(writer?.error)
    let didWriteSamples = sessionStarted && appendedSampleCount > 0
    let hadMicSamples = micAppendedSampleCount > 0
    let stats = "sessionStarted=\(sessionStarted) appended=\(appendedSampleCount) "
      + "micAppended=\(micAppendedSampleCount) devices: \(describeDefaultAudioDevices())"
    log("SCK stats: \(stats)")

    let elapsed = startTime.map { Date().timeIntervalSince($0) } ?? 0
    let duration = max(0, elapsed - totalPausedDuration)
    let savedPath = outputPath

    cleanup()

    if hasStorageWriteError {
      log("SCK recording storage insufficient: \(writerError)")
      output(terminalError: "storage_insufficient", path: savedPath, detail: writerError, handoffId: handoffId)
      return
    }

    if !didWriteSamples {
      log("SCK writer finish failed: no audio samples")
      checkpoints?.deleteAll()
      try? FileManager.default.removeItem(atPath: savedPath)
      output(terminalError: "no_audio_samples", path: savedPath, detail: stats, handoffId: handoffId)
      return
    }

    if writerStatus != .completed {
      log("SCK writer finish failed: status=\(writerStatus?.rawValue ?? -1) error=\(writerError)")
      try? FileManager.default.removeItem(atPath: savedPath)
      output(terminalError: "writer_failed", path: savedPath, detail: writerError, handoffId: handoffId)
      return
    }

    if hadMicSamples || SYSTEM_AUDIO_VOLUME_WITHOUT_MIC != 1 {
      output(status: "mixing", path: savedPath)
      /** writer 契约固定 system=2ch、mic=1ch，只衰减系统轨，不误伤人声 */
      let mixed = await mixTracks(
        inputPath: savedPath,
        primaryInputVolume: hadMicSamples
          ? 1
          : SYSTEM_AUDIO_VOLUME_WITHOUT_MIC,
        primaryInputVolumesByChannelCount: hadMicSamples
          ? [2: SYSTEM_AUDIO_VOLUME_WITH_MIC]
          : [:]
      )
      guard mixed else {
        let detail = "final audio render failed; recovery assets preserved"
        log("SCK: \(detail)")
        output(terminalError: "writer_failed", path: savedPath, detail: detail, handoffId: handoffId)
        return
      }
    }

    output(status: "stopped", path: savedPath, duration: duration, handoffId: handoffId)
  }

  private func startFirstSampleWatchdog() {
    firstSampleErrorEmitted = false
    let token = UUID()
    let path = outputPath
    firstSampleWatchdogToken = token

    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + FIRST_AUDIO_SAMPLE_TIMEOUT) { [weak self] in
      guard let self else { return }

      self.sampleQueue.async { [weak self] in
        guard let self else { return }
        guard self.firstSampleWatchdogToken == token,
              self.stream != nil,
              self.hasMic,
              !self.paused,
              !self.sessionStarted,
              !self.firstSampleErrorEmitted
        else { return }

        self.firstSampleErrorEmitted = true
        log("SCK first audio sample timeout")
        self.output(error: "no_audio_samples", path: path, detail: "no first sample within \(Int(FIRST_AUDIO_SAMPLE_TIMEOUT))s, devices: \(describeDefaultAudioDevices())")
      }
    }
  }

  private func startSampleGapWatchdog() {
    sampleGapErrorEmitted = false
    let token = UUID()
    sampleGapWatchdogToken = token
    scheduleSampleGapWatchdog(token, path: outputPath)
  }

  private func scheduleSampleGapWatchdog(_ token: UUID, path: String) {
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + AUDIO_SAMPLE_GAP_WATCHDOG_INTERVAL) { [weak self] in
      guard let self else { return }

      self.sampleQueue.async { [weak self] in
        guard let self else { return }
        guard self.sampleGapWatchdogToken == token,
              self.stream != nil
        else { return }

        if !self.paused,
           self.hasMic,
           let lastSampleAt = self.lastSampleAt,
           Date().timeIntervalSince(lastSampleAt) >= AUDIO_SAMPLE_GAP_TIMEOUT,
           !self.sampleGapErrorEmitted {
          self.sampleGapErrorEmitted = true
          let gap = Int(Date().timeIntervalSince(lastSampleAt))
          log("SCK audio sample gap timeout (gap=\(gap)s)")
          self.output(error: "audio_sample_timeout", path: path, detail: "no samples for \(gap)s, appended=\(self.appendedSampleCount), devices: \(describeDefaultAudioDevices())")
          return
        }

        self.scheduleSampleGapWatchdog(token, path: path)
      }
    }
  }

  private func setupWriter(outputPath: String) throws {
    let url = URL(fileURLWithPath: outputPath)
    try? FileManager.default.removeItem(at: url)

    let w = try AVAssetWriter(outputURL: url, fileType: .m4a)

    let systemSettings = aacSystemAudioSettings()
    let sysInput = try addAudioWriterInput(
      to: w,
      outputSettings: systemSettings,
      expectsMediaDataInRealTime: true
    )

    if hasMic {
      let mInput = try addAudioWriterInput(
        to: w,
        outputSettings: aacMicSettings(),
        expectsMediaDataInRealTime: true
      )
      self.micInput = mInput
    }

    try startAudioWriter(w)

    self.writer = w
    self.systemInput = sysInput
    self.checkpointWriter = AudioCheckpointWriter(
      outputPath: outputPath,
      systemSettings: systemSettings,
      micSettings: hasMic
        ? aacMicSettings()
        : nil
    )
    self.sessionStarted = false
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard !paused else { return }
    guard sampleBuffer.isValid else { return }
    guard let writer = writer, writer.status == .writing else { return }

    if !sessionStarted {
      let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
      writer.startSession(atSourceTime: pts)
      sessionStarted = true
    }

    switch type {
    case .audio:
      if let input = systemInput, input.isReadyForMoreMediaData {
        if input.append(sampleBuffer) {
          appendedSampleCount += 1
          lastSampleAt = Date()
          checkpointWriter?.append(sampleBuffer, track: .system)
        }
      }
    case .microphone:
      if let input = micInput, input.isReadyForMoreMediaData {
        if input.append(sampleBuffer) {
          appendedSampleCount += 1
          micAppendedSampleCount += 1
          lastSampleAt = Date()
          checkpointWriter?.append(sampleBuffer, track: .mic)
        }
      }
    default:
      break
    }
  }

  private func cleanup() {
    stream = nil
    writer = nil
    checkpointWriter = nil
    systemInput = nil
    micInput = nil
    hasMic = false
    paused = false
    startTime = nil
    totalPausedDuration = 0
    pausedAt = nil
    sessionStarted = false
    appendedSampleCount = 0
    micAppendedSampleCount = 0
    firstSampleWatchdogToken = UUID()
    firstSampleErrorEmitted = false
    sampleGapWatchdogToken = UUID()
    sampleGapErrorEmitted = false
    lastSampleAt = nil
  }

  // ── stdout JSON ──

  private func output(status: String, path: String, duration: Double? = nil, handoffId: Int? = nil) {
    emitStatus(status, path: path, duration: duration, handoffId: handoffId)
  }

  private func output(error: String, path: String? = nil, detail: String? = nil) {
    if let path {
      emitRecordingError(error, path: path, detail: detail)
    }
    else {
      emitError(error, detail: detail)
    }
  }

  private func output(terminalError error: String, path: String, detail: String? = nil, handoffId: Int? = nil) {
    emitTerminalError(error, path: path, detail: detail, handoffId: handoffId)
  }
}

// MARK: - 混音后处理（读 2 轨混合为单轨，两引擎共用）

/// 后处理：读 1+ 个音频文件 → AVAssetReaderAudioMixOutput 混合 → 写单轨 M4A（SCK / tap 两引擎共用）

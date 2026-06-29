import Cocoa
import CoreGraphics
import ScreenCaptureKit
import AVFoundation

// stdin JSON → {"action":"start","outputPath":"/tmp/rec.m4a"}
//            → {"action":"stop"}
// stdout JSON ← {"status":"recording","path":"..."}
//             ← {"status":"stopped","path":"...","duration":125.3}
//             ← {"error":"..."}

signal(SIGPIPE, SIG_IGN)

func isScreenCaptureTrusted() -> Bool {
  if #available(macOS 10.15, *) {
    return CGPreflightScreenCaptureAccess()
  }
  return true
}

func requestScreenCaptureAccess() -> Bool {
  if #available(macOS 10.15, *) {
    return CGRequestScreenCaptureAccess()
  }
  return true
}

if CommandLine.arguments.contains("--check-screen-capture") {
  if isScreenCaptureTrusted() {
    print("SCREEN_CAPTURE_TRUSTED")
    exit(0)
  }

  fputs("SCREEN_CAPTURE_NOT_TRUSTED\n", stderr)
  exit(1)
}

if CommandLine.arguments.contains("--prompt-screen-capture") {
  if requestScreenCaptureAccess() {
    print("SCREEN_CAPTURE_TRUSTED")
    exit(0)
  }

  fputs("SCREEN_CAPTURE_NOT_TRUSTED\n", stderr)
  exit(1)
}

class Recorder: NSObject, SCStreamOutput {
  private var stream: SCStream?
  private var writer: AVAssetWriter?
  private var systemInput: AVAssetWriterInput?
  private var micInput: AVAssetWriterInput? // macOS 15.0+ only
  private var hasMic = false
  private var paused = false
  private var outputPath: String = ""
  private var startTime: Date?
  private var totalPausedDuration: TimeInterval = 0
  private var pausedAt: Date?
  private var sessionStarted = false

  func start(outputPath: String) async {
    guard stream == nil else {
      output(error: "already_recording")
      return
    }

    self.outputPath = outputPath

    do {
      let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
      guard let display = content.displays.first else {
        output(error: "no_display")
        return
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

      let queue = DispatchQueue(label: "audio-recorder", qos: .userInitiated)
      try scStream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
      if #available(macOS 15.0, *) {
        try scStream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: queue)
      }

      try await scStream.startCapture()
      self.stream = scStream
      self.startTime = Date()

      output(status: "recording", path: outputPath)
    }
    catch let error as NSError {
      if error.domain == "com.apple.ScreenCaptureKit"
        || error.localizedDescription.contains("permission") {
        output(error: "permission_denied")
      }
      else {
        output(error: error.localizedDescription)
      }
      cleanup()
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
    output(status: "recording", path: outputPath)
  }

  func stop() async {
    guard let scStream = stream else {
      output(error: "not_recording")
      return
    }
    if paused, let pa = pausedAt {
      totalPausedDuration += Date().timeIntervalSince(pa)
    }

    do { try await scStream.stopCapture() }
    catch { log("stop capture error: \(error)") }

    systemInput?.markAsFinished()
    micInput?.markAsFinished()

    let hadMic = hasMic

    if let writer = writer, writer.status == .writing {
      await writer.finishWriting()
    }

    let elapsed = startTime.map { Date().timeIntervalSince($0) } ?? 0
    let duration = max(0, elapsed - totalPausedDuration)
    let savedPath = outputPath

    cleanup()

    if hadMic {
      output(status: "mixing", path: savedPath)
      let mixed = await mixTracks(inputPath: savedPath)
      if !mixed {
        log("mixTracks failed, keeping original 2-track file")
      }
    }

    output(status: "stopped", path: savedPath, duration: duration)
  }

  /// 后处理：读 2 轨 M4A → AVAssetReaderAudioMixOutput 混合 → 写单轨 M4A
  private func mixTracks(inputPath: String) async -> Bool {
    let inputURL = URL(fileURLWithPath: inputPath)
    let tmpURL = inputURL.deletingLastPathComponent()
      .appendingPathComponent("_mix_\(ProcessInfo.processInfo.globallyUniqueString).m4a")

    let asset = AVURLAsset(url: inputURL)

    do {
      let tracks = try await asset.loadTracks(withMediaType: .audio)
      guard tracks.count >= 2 else {
        log("mixTracks: only \(tracks.count) track(s), skipping")
        return true
      }

      let reader = try AVAssetReader(asset: asset)

      let mixOutput = AVAssetReaderAudioMixOutput(
        audioTracks: tracks,
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
      let writerInput = AVAssetWriterInput(mediaType: .audio, outputSettings: [
        AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
        AVSampleRateKey: 48000,
        AVNumberOfChannelsKey: 2,
        AVEncoderBitRateKey: 128_000,
      ])
      writer.add(writerInput)

      reader.startReading()
      writer.startWriting()
      writer.startSession(atSourceTime: .zero)

      await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
        writerInput.requestMediaDataWhenReady(on: DispatchQueue(label: "mix-writer")) {
          while writerInput.isReadyForMoreMediaData {
            if let buf = mixOutput.copyNextSampleBuffer() {
              writerInput.append(buf)
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

      guard writer.status == .completed else {
        log("mixTracks writer error: \(writer.error?.localizedDescription ?? "unknown")")
        try? FileManager.default.removeItem(at: tmpURL)
        return false
      }

      try FileManager.default.removeItem(at: inputURL)
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

  private func setupWriter(outputPath: String) throws {
    let url = URL(fileURLWithPath: outputPath)
    try? FileManager.default.removeItem(at: url)

    let w = try AVAssetWriter(outputURL: url, fileType: .m4a)

    let systemSettings: [String: Any] = [
      AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
      AVSampleRateKey: 48000,
      AVNumberOfChannelsKey: 2,
      AVEncoderBitRateKey: 128_000,
    ]

    let sysInput = AVAssetWriterInput(mediaType: .audio, outputSettings: systemSettings)
    sysInput.expectsMediaDataInRealTime = true
    w.add(sysInput)

    if hasMic {
      let micSettings: [String: Any] = [
        AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
        AVSampleRateKey: 48000,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 64_000,
      ]

      let mInput = AVAssetWriterInput(mediaType: .audio, outputSettings: micSettings)
      mInput.expectsMediaDataInRealTime = true
      w.add(mInput)
      self.micInput = mInput
    }

    w.startWriting()

    self.writer = w
    self.systemInput = sysInput
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
        input.append(sampleBuffer)
      }
    case .microphone:
      if let input = micInput, input.isReadyForMoreMediaData {
        input.append(sampleBuffer)
      }
    default:
      break
    }
  }

  private func cleanup() {
    stream = nil
    writer = nil
    systemInput = nil
    micInput = nil
    hasMic = false
    paused = false
    startTime = nil
    totalPausedDuration = 0
    pausedAt = nil
    sessionStarted = false
  }

  // ── stdout JSON ──

  private func output(status: String, path: String, duration: Double? = nil) {
    var json = "{\"status\":\"\(status)\",\"path\":\"\(escapeJSON(path))\""
    if let d = duration {
      json += ",\"duration\":\(String(format: "%.1f", d))"
    }
    json += "}"
    print(json)
    fflush(stdout)
  }

  private func output(error: String) {
    print("{\"error\":\"\(escapeJSON(error))\"}")
    fflush(stdout)
  }
}

func escapeJSON(_ s: String) -> String {
  s.replacingOccurrences(of: "\\", with: "\\\\")
   .replacingOccurrences(of: "\"", with: "\\\"")
   .replacingOccurrences(of: "\n", with: "\\n")
}

func log(_ msg: String) {
  FileHandle.standardError.write("[\(msg)]\n".data(using: .utf8)!)
}

// ── stdin command loop ──

let recorder = Recorder()

func handleCommand(_ line: String) async {
  guard let data = line.data(using: .utf8),
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let action = json["action"] as? String
  else { return }

  switch action {
  case "start":
    let outputPath = json["outputPath"] as? String ?? "/tmp/audio-recording-\(Int(Date().timeIntervalSince1970)).m4a"
    await recorder.start(outputPath: outputPath)
  case "pause":
    recorder.pause()
  case "resume":
    recorder.resume()
  case "stop":
    await recorder.stop()
  default:
    break
  }
}

// SIGTERM → 优雅停止录制再退出（NativeBridge.stop() 发 SIGTERM）
let sigTermSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
signal(SIGTERM, SIG_IGN)
sigTermSource.setEventHandler {
  Task {
    await recorder.stop()
    exit(0)
  }
}
sigTermSource.resume()

// 检测父进程存活
let parentCheckTimer = DispatchSource.makeTimerSource(queue: .main)
parentCheckTimer.schedule(deadline: .now() + 3, repeating: 3)
parentCheckTimer.setEventHandler {
  if getppid() == 1 {
    Task { await recorder.stop() }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(0) }
  }
}
parentCheckTimer.resume()

// 读 stdin（阻塞，放后台线程）
DispatchQueue.global(qos: .userInitiated).async {
  while let line = readLine() {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { continue }
    Task { await handleCommand(trimmed) }
  }
  // stdin 关闭 = 父进程退出
  Task { await recorder.stop() }
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(0) }
}

CFRunLoopRun()

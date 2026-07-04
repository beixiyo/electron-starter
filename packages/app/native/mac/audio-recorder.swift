import AVFoundation
import Cocoa
import CoreAudio
import CoreGraphics
import CoreMedia
import ScreenCaptureKit

// stdin JSON → {"action":"start","outputPath":"/tmp/rec.m4a"}                        // 会议录音:ScreenCaptureKit 全系统音频
//            → {"action":"start","outputPath":"...","engine":"tap","tapEnabled":false,
//               "pids":[123],"excludePids":[456],"mic":true,"micAec":true}                        // 手动录音:tap 引擎(macOS 14.2+);tapEnabled=false 先纯 mic
//            → {"action":"update","tapEnabled":true,"micEnabled":true,"pids":[123],"excludePids":[456]} // tap 录音中热挂/卸 mic 与系统音轨、变更混入进程集合
//            → {"action":"stop"}
// stdout JSON ← {"status":"recording","path":"..."}
//             ← {"status":"stopped","path":"...","duration":125.3}
//             ← {"error":"..."}

signal(SIGPIPE, SIG_IGN)

// MARK: - CLI 权限探测入口（--check/--prompt-*，探测完即 exit）

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

// ── System Audio Recording Only 权限(kTCCServiceAudioCapture)──
// process tap 录音的独立 TCC 权限,与屏幕录制完全分开;无公开查询 API,
// 经私有 TCC.framework 探测(Developer ID 分发可用,MAS 禁用私有 SPI)。
// 弹窗归属 responsible process(父 Electron app),usage description 已在 electron-builder.yml 注入

typealias TCCAccessPreflightFn = @convention(c) (CFString, CFDictionary?) -> Int32
typealias TCCAccessRequestFn = @convention(c) (CFString, CFDictionary?, @escaping (Bool) -> Void) -> Void

func loadTCCFunctions() -> (preflight: TCCAccessPreflightFn, request: TCCAccessRequestFn)? {
  guard let handle = dlopen("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_NOW),
        let preflightSymbol = dlsym(handle, "TCCAccessPreflight"),
        let requestSymbol = dlsym(handle, "TCCAccessRequest")
  else { return nil }

  return (
    unsafeBitCast(preflightSymbol, to: TCCAccessPreflightFn.self),
    unsafeBitCast(requestSymbol, to: TCCAccessRequestFn.self)
  )
}

let kTCCServiceAudioCaptureName = "kTCCServiceAudioCapture" as CFString

// exit code 约定:0=granted 1=denied 2=not-determined/超时 3=SPI 不可用 4=系统版本不支持
if CommandLine.arguments.contains("--check-audio-capture") {
  guard #available(macOS 14.2, *) else {
    fputs("AUDIO_CAPTURE_UNSUPPORTED\n", stderr)
    exit(4)
  }
  guard let tcc = loadTCCFunctions() else {
    fputs("AUDIO_CAPTURE_SPI_UNAVAILABLE\n", stderr)
    exit(3)
  }

  switch tcc.preflight(kTCCServiceAudioCaptureName, nil) {
  case 0:
    print("AUDIO_CAPTURE_GRANTED")
    exit(0)
  case 1:
    fputs("AUDIO_CAPTURE_DENIED\n", stderr)
    exit(1)
  default:
    fputs("AUDIO_CAPTURE_NOT_DETERMINED\n", stderr)
    exit(2)
  }
}

if CommandLine.arguments.contains("--prompt-audio-capture") {
  guard #available(macOS 14.2, *) else {
    fputs("AUDIO_CAPTURE_UNSUPPORTED\n", stderr)
    exit(4)
  }
  guard let tcc = loadTCCFunctions() else {
    fputs("AUDIO_CAPTURE_SPI_UNAVAILABLE\n", stderr)
    exit(3)
  }

  tcc.request(kTCCServiceAudioCaptureName, nil) { granted in
    if granted {
      print("AUDIO_CAPTURE_GRANTED")
      exit(0)
    }
    fputs("AUDIO_CAPTURE_DENIED\n", stderr)
    exit(1)
  }

  /** 用户长时间不操作授权弹窗的兜底,避免调用方 execFile 永久挂起 */
  DispatchQueue.main.asyncAfter(deadline: .now() + 300) {
    fputs("AUDIO_CAPTURE_TIMEOUT\n", stderr)
    exit(2)
  }
  CFRunLoopRun()
}

// ── stdout JSON(SCK 与 tap 两个引擎共用) ──

func emitStatus(_ status: String, path: String, duration: Double? = nil) {
  var json = "{\"status\":\"\(status)\",\"path\":\"\(escapeJSON(path))\""
  if let d = duration {
    json += ",\"duration\":\(String(format: "%.1f", d))"
  }
  json += "}"
  print(json)
  fflush(stdout)
}

func emitError(_ error: String, detail: String? = nil) {
  var json = "{\"error\":\"\(escapeJSON(error))\""
  if let detail {
    json += ",\"detail\":\"\(escapeJSON(detail))\""
  }
  json += "}"
  print(json)
  fflush(stdout)
}

/** NSError 展开为 domain#code(+underlying),writer 失败等诊断必须带错误码落盘,localizedDescription 只有通用文案无法定位根因 */
func describeError(_ error: Error?) -> String {
  guard let error else { return "unknown" }
  let ns = error as NSError
  var desc = "\(ns.domain)#\(ns.code): \(ns.localizedDescription)"
  if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError {
    desc += " underlying=\(underlying.domain)#\(underlying.code)"
  }
  return desc
}

// ── 设备拓扑快照(两引擎开录时落盘,虚拟声卡 / 聚合设备是 VPIO 无样本类故障的关键环境因素) ──

/** 默认输入 / 输出设备一行描述:名称 + 采样率 + 传输类型,读取失败返回错误码占位不抛错 */
func describeDefaultAudioDevices() -> String {
  "in=\(describeDefaultDevice(selector: kAudioHardwarePropertyDefaultInputDevice)) out=\(describeDefaultDevice(selector: kAudioHardwarePropertyDefaultOutputDevice))"
}

private func describeDefaultDevice(selector: AudioObjectPropertySelector) -> String {
  var address = AudioObjectPropertyAddress(
    mSelector: selector,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var deviceID = AudioObjectID(kAudioObjectUnknown)
  var dataSize = UInt32(MemoryLayout<AudioObjectID>.size)
  let err = AudioObjectGetPropertyData(
    AudioObjectID(kAudioObjectSystemObject),
    &address, 0, nil, &dataSize, &deviceID
  )
  guard err == noErr, deviceID != AudioObjectID(kAudioObjectUnknown) else {
    return "<unavailable_\(err)>"
  }

  let name = readDeviceCFString(deviceID, selector: kAudioObjectPropertyName) ?? "<unnamed>"
  let rate = readDeviceSampleRate(deviceID).map { "\(Int($0))Hz" } ?? "?Hz"
  return "\"\(name)\" (\(rate), \(readDeviceTransport(deviceID)))"
}

private func readDeviceCFString(_ deviceID: AudioObjectID, selector: AudioObjectPropertySelector) -> String? {
  var address = AudioObjectPropertyAddress(
    mSelector: selector,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var value: CFString = "" as CFString
  var size = UInt32(MemoryLayout<CFString>.size)
  let err = withUnsafeMutablePointer(to: &value) { ptr in
    AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, ptr)
  }
  guard err == noErr else { return nil }
  return value as String
}

private func readDeviceSampleRate(_ deviceID: AudioObjectID) -> Double? {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyNominalSampleRate,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var rate: Float64 = 0
  var size = UInt32(MemoryLayout<Float64>.size)
  let err = AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &rate)
  guard err == noErr, rate > 0 else { return nil }
  return rate
}

private func readDeviceTransport(_ deviceID: AudioObjectID) -> String {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyTransportType,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var transport: UInt32 = 0
  var size = UInt32(MemoryLayout<UInt32>.size)
  let err = AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &transport)
  guard err == noErr else { return "transport?" }

  switch transport {
  case kAudioDeviceTransportTypeBuiltIn: return "builtin"
  case kAudioDeviceTransportTypeVirtual: return "virtual"
  case kAudioDeviceTransportTypeAggregate: return "aggregate"
  case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE: return "bluetooth"
  case kAudioDeviceTransportTypeUSB: return "usb"
  case kAudioDeviceTransportTypeHDMI: return "hdmi"
  case kAudioDeviceTransportTypeDisplayPort: return "displayport"
  case kAudioDeviceTransportTypeAirPlay: return "airplay"
  case kAudioDeviceTransportTypeThunderbolt: return "thunderbolt"
  default: return String(format: "transport_0x%08x", transport)
  }
}

// MARK: - AAC 编码参数（系统音轨 / mic 轨 / 混音成品三处写入器共用）

/** 系统音轨 / 混音成品：2ch 128k；48k 内的原生采样率透传，其余交写入器重采样 */
func aacSystemAudioSettings(sampleRate: Double = 48000) -> [String: Any] {
  [
    AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
    AVSampleRateKey: sampleRate,
    AVNumberOfChannelsKey: 2,
    AVEncoderBitRateKey: 128_000,
  ]
}

/** mic 轨：1ch 64k */
func aacMicSettings() -> [String: Any] {
  [
    AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
    AVSampleRateKey: 48000,
    AVNumberOfChannelsKey: 1,
    AVEncoderBitRateKey: 64_000,
  ]
}

let FIRST_AUDIO_SAMPLE_TIMEOUT: TimeInterval = 5
let AUDIO_SAMPLE_GAP_TIMEOUT: TimeInterval = 30
let AUDIO_SAMPLE_GAP_WATCHDOG_INTERVAL: TimeInterval = 5

// MARK: - SCK 会议引擎（全系统音频 + mic，依赖屏幕录制权限）

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
  /** 真实落盘样本数(append 成功才计):sessionStarted 只代表首帧到达,零 append 的空文件必须靠它拦截 */
  private var appendedSampleCount = 0
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
      if error.domain == "com.apple.ScreenCaptureKit"
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

  func stop() async {
    guard let scStream = stream else {
      output(error: "not_recording")
      return
    }
    guard !isFinalizingRecording else { return }
    isFinalizingRecording = true
    defer { isFinalizingRecording = false }

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
    let writerStatus = writer?.status
    let writerError = describeError(writer?.error)
    let didWriteSamples = sessionStarted && appendedSampleCount > 0
    let stats = "sessionStarted=\(sessionStarted) appended=\(appendedSampleCount) devices: \(describeDefaultAudioDevices())"
    log("SCK stats: \(stats)")

    let elapsed = startTime.map { Date().timeIntervalSince($0) } ?? 0
    let duration = max(0, elapsed - totalPausedDuration)
    let savedPath = outputPath

    cleanup()

    if !didWriteSamples {
      log("SCK writer finish failed: no audio samples")
      try? FileManager.default.removeItem(atPath: savedPath)
      output(error: "no_audio_samples", detail: stats)
      return
    }

    if writerStatus != .completed {
      log("SCK writer finish failed: status=\(writerStatus?.rawValue ?? -1) error=\(writerError)")
      try? FileManager.default.removeItem(atPath: savedPath)
      output(error: "writer_failed", detail: writerError)
      return
    }

    if hadMic {
      output(status: "mixing", path: savedPath)
      let mixed = await mixTracks(inputPath: savedPath)
      if !mixed {
        log("mixTracks failed, keeping original 2-track file")
      }
    }

    output(status: "stopped", path: savedPath, duration: duration)
  }

  private func startFirstSampleWatchdog() {
    firstSampleErrorEmitted = false
    let token = UUID()
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
        self.output(error: "no_audio_samples", detail: "no first sample within \(Int(FIRST_AUDIO_SAMPLE_TIMEOUT))s, devices: \(describeDefaultAudioDevices())")
      }
    }
  }

  private func startSampleGapWatchdog() {
    sampleGapErrorEmitted = false
    let token = UUID()
    sampleGapWatchdogToken = token
    scheduleSampleGapWatchdog(token)
  }

  private func scheduleSampleGapWatchdog(_ token: UUID) {
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
          self.output(error: "audio_sample_timeout", detail: "no samples for \(gap)s, appended=\(self.appendedSampleCount), devices: \(describeDefaultAudioDevices())")
          return
        }

        self.scheduleSampleGapWatchdog(token)
      }
    }
  }

  private func setupWriter(outputPath: String) throws {
    let url = URL(fileURLWithPath: outputPath)
    try? FileManager.default.removeItem(at: url)

    let w = try AVAssetWriter(outputURL: url, fileType: .m4a)

    let sysInput = AVAssetWriterInput(mediaType: .audio, outputSettings: aacSystemAudioSettings())
    sysInput.expectsMediaDataInRealTime = true
    w.add(sysInput)

    if hasMic {
      let mInput = AVAssetWriterInput(mediaType: .audio, outputSettings: aacMicSettings())
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
        if input.append(sampleBuffer) {
          appendedSampleCount += 1
          lastSampleAt = Date()
        }
      }
    case .microphone:
      if let input = micInput, input.isReadyForMoreMediaData {
        if input.append(sampleBuffer) {
          appendedSampleCount += 1
          lastSampleAt = Date()
        }
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
    appendedSampleCount = 0
    firstSampleWatchdogToken = UUID()
    firstSampleErrorEmitted = false
    sampleGapWatchdogToken = UUID()
    sampleGapErrorEmitted = false
    lastSampleAt = nil
  }

  // ── stdout JSON ──

  private func output(status: String, path: String, duration: Double? = nil) {
    emitStatus(status, path: path, duration: duration)
  }

  private func output(error: String, detail: String? = nil) {
    emitError(error, detail: detail)
  }
}

// MARK: - 混音后处理（读 2 轨混合为单轨，两引擎共用）

/// 后处理：读 2 轨 M4A → AVAssetReaderAudioMixOutput 混合 → 写单轨 M4A（SCK / tap 两引擎共用）
func mixTracks(inputPath: String) async -> Bool {
  let inputURL = URL(fileURLWithPath: inputPath)
  let tmpURL = inputURL.deletingLastPathComponent()
    .appendingPathComponent("_mix_\(ProcessInfo.processInfo.globallyUniqueString).m4a")

  let asset = AVURLAsset(url: inputURL)

  do {
    let allTracks = try await asset.loadTracks(withMediaType: .audio)

    /** 纯 mic 录音的预建系统音轨是零样本空轨,参与混音会干扰输出,先剔除 */
    var tracks: [AVAssetTrack] = []
    for track in allTracks {
      let timeRange = try await track.load(.timeRange)
      log("mixTracks: track range=\(timeRange.start.seconds)s +\(timeRange.duration.seconds)s")
      if timeRange.duration > .zero {
        tracks.append(track)
      }
    }

    /**
     * 音源可录音中任意增减,收尾时非空轨可能是 1 条(纯系统 / 纯 mic)或 2 条(混音):
     * 都经 AVAssetReaderAudioMixOutput 转出单轨(1 条为直通,2 条为混合),产物永远干净单轨。
     * 0 条(全空,理论不达)才跳过
     */
    guard !tracks.isEmpty else {
      log("mixTracks: no non-empty track, skipping")
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
    let writerInput = AVAssetWriterInput(mediaType: .audio, outputSettings: aacSystemAudioSettings())
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

// ── 手动录音引擎:Core Audio process tap(macOS 14.2+) ──
//
// 与会议录音的 ScreenCaptureKit 引擎互斥。差异:
// - 权限:只需「System Audio Recording Only」TCC(kTCCServiceAudioCapture),不需要屏幕录制
// - 支持按进程过滤:pids 非空 = 仅混入这些进程;pids 为空 = 全系统混音并排除 excludePids(自身进程族)
// - 系统音轨可热挂/卸:tapEnabled=false 纯 mic 开录(系统音轨预建空轨),录音中经 update 随时挂上/摘下 tap
// - 麦克风:优先 AVAudioEngine voice processing(苹果 AEC,对齐浏览器 getUserMedia echoCancellation),
//   失败降级裸 AVCaptureSession(不依赖 macOS 15 的 SCK captureMicrophone)
//
// 流程:pid → AudioObjectID → CATapDescription → AudioHardwareCreateProcessTap
//     → 私有聚合设备(默认输出为 main sub-device,tap 挂 TapList,AudioCap 同配方)
//     → IOProc 读 PCM → CMSampleBuffer → AVAssetWriter;停止后复用 mixTracks 混单轨 M4A

struct TapRecorderError: Error {
  let message: String

  init(_ message: String) {
    self.message = message
  }
}

// MARK: - Tap 手动录音引擎（Core Audio process tap + mic 双轨，macOS 14.2+）

@available(macOS 14.2, *)
class TapRecorder: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
  private var tapID = AudioObjectID(kAudioObjectUnknown)
  private var aggregateID = AudioObjectID(kAudioObjectUnknown)
  private var deviceProcID: AudioDeviceIOProcID?
  /** tap IOProc 与 mic 回调共用一条串行队列,保证 writer 启动会话与 append 无竞态 */
  private let sampleQueue = DispatchQueue(label: "tap-recorder", qos: .userInitiated)

  private var writer: AVAssetWriter?
  private var systemInput: AVAssetWriterInput?
  private var micInput: AVAssetWriterInput?
  private var captureSession: AVCaptureSession?
  private var audioEngine: AVAudioEngine?
  /** mic 采集是否挂载中(mic 轨恒预建;active 决定是否进样,支持录音中热挂/卸) */
  private var micActive = false
  /** 录音中重新 attach mic 复用的 AEC 偏好(start 时传入) */
  private var micAecPref = true
  /** tap 采集管线是否挂载中(可录音中热挂/卸;false 时系统音轨停止进样,mic 轨照常) */
  private var tapActive = false

  private var paused = false
  private var outputPath = ""
  private var startTime: Date?
  private var totalPausedDuration: TimeInterval = 0
  private var pausedAt: Date?
  private var sessionStarted = false
  /**
   * 暂停时段累计的 host-time 偏移:恢复后所有样本 PTS 统一回拨该值,产物里不留暂停间隙——
   * 与 web MediaRecorder.pause 的时间轴语义对齐,保证转写时间戳与笔记 elapsed 一致
   */
  private var pauseOffset = CMTime.zero
  private var pauseStartHostTime: CMTime?
  private var firstSampleWatchdogToken = UUID()
  private var firstSampleErrorEmitted = false
  private var sampleGapWatchdogToken = UUID()
  private var sampleGapErrorEmitted = false
  private var lastSampleAt: Date?

  private var tapFormat: AudioStreamBasicDescription?
  private var tapFormatDescription: CMAudioFormatDescription?
  /** VPIO mic 格式引擎生命周期内恒定,建一次缓存复用,避免每 buffer 重建 CMAudioFormatDescription（音频渲染线程反模式） */
  private var micFormatDescription: CMAudioFormatDescription?

  /**
   * 静音诊断:未授权时 tap 管线各层全部 noErr、回调照常,但样本恒为 0(已被多源证实),
   * 只能靠内容发现。此处仅 stderr 告警不报错——「确实没声音在播」也是全零,不能误报
   */
  private var receivedNonSilentBuffer = false
  private var silentBufferCount = 0

  /** 采样统计（stop 时打点）:定位「回调没来 / 转换失败 / writer 不收」三类静默丢样 */
  private var tapCallbackCount = 0
  private var sysAppendCount = 0
  private var sysDropCount = 0
  private var micCallbackCount = 0
  private var micConvertFailCount = 0
  private var micAppendCount = 0
  private var micDropCount = 0

  @discardableResult
  func start(outputPath: String, pids: [pid_t], excludePids: [pid_t], withMic: Bool, tapEnabled: Bool, micAec: Bool) async -> Bool {
    guard writer == nil else {
      emitError("already_recording")
      return false
    }

    self.outputPath = outputPath
    self.micAecPref = micAec

    do {
      /**
       * 顺序约束:先起 mic 引擎再建 tap 管线——VPIO(AEC)启动会重配置输出设备,
       * 之后读到的 tap 格式才与实际回调一致;mic 设备不可用时降级为仅系统音频,
       * 不整体失败(mic 权限由 TS 侧前置保证)
       */
      let micReady = withMic
        ? attachMic(aec: micAec)
        : false
      guard tapEnabled || micReady else {
        throw TapRecorderError("no_capture_source")
      }

      /** tapEnabled=false:纯 mic 开录,系统音轨预建空轨,后续可经 update 热挂 tap */
      if tapEnabled {
        let description = try makeTapDescription(pids: pids, excludePids: excludePids)
        try buildTapPipeline(description)
      }
      /** mic 轨恒预建(即使 withMic=false),支持录音中热挂 mic;空轨由 mixTracks 零时长过滤剔除 */
      try setupWriter(outputPath: outputPath)

      if tapEnabled {
        try startIOProc()
        tapActive = true
      }

      startTime = Date()
      startFirstSampleWatchdog()
      startSampleGapWatchdog()
      log("tap start: mic=\(micReady) tap=\(tapEnabled) devices: \(describeDefaultAudioDevices())")
      emitStatus("recording", path: outputPath)
      return true
    }
    catch {
      emitError((error as? TapRecorderError)?.message ?? error.localizedDescription)
      cleanup()
      return false
    }
  }

  /**
   * 录音中在线变更音源（UI 音源多选条勾选变化时调用）：
   * - mic：micEnabled 切换 mic 采集引擎挂/卸（mic 轨恒预建，只切进样）
   * - tap：tapEnabled=false 拆 tap 管线；true 且未挂载则新建；true 且已挂载则重建（变更进程集合）
   *
   * writer 两轨恒不动，PTS 用 host time 天然连续，切换只产生几十毫秒的音源间隙。
   * 新描述构造失败（如目标进程已退出）时旧管线原样保留，仅记日志不打断录音
   */
  func update(tapEnabled: Bool, micEnabled: Bool, pids: [pid_t], excludePids: [pid_t]) {
    guard writer != nil else {
      log("update ignored: not recording")
      return
    }

    /** mic 热切：与 tap 独立，micInput 恒在，只起停采集引擎 */
    if micEnabled, !micActive {
      if attachMic(aec: micAecPref) {
        log("mic attached")
      }
      else {
        log("mic attach failed, no mic capture")
      }
    }
    else if !micEnabled, micActive {
      detachMic()
      log("mic detached")
    }

    if !tapEnabled {
      if tapActive {
        teardownTapPipeline()
        tapActive = false
        log("tap detached")
      }
      return
    }

    let description: CATapDescription
    do {
      description = try makeTapDescription(pids: pids, excludePids: excludePids)
    }
    catch {
      log("tap update rejected: \((error as? TapRecorderError)?.message ?? error.localizedDescription)")
      return
    }

    if tapActive {
      teardownTapPipeline()
      tapActive = false
    }

    do {
      try buildTapPipeline(description)
      try startIOProc()
      tapActive = true
      log("tap attached: pids=[\(pids.map(String.init).joined(separator: ","))]")
    }
    catch {
      /** 罕见:旧管线已拆、新管线失败——mic 轨继续录,系统音轨静默缺失,只能日志留痕 */
      log("tap update failed after teardown: \((error as? TapRecorderError)?.message ?? error.localizedDescription)")
    }
  }

  /** 创建 tap → 读格式 → 聚合设备(IOProc 由调用方按需启动),start 与 update 共用 */
  private func buildTapPipeline(_ description: CATapDescription) throws {
    var newTapID = AudioObjectID(kAudioObjectUnknown)
    let tapErr = AudioHardwareCreateProcessTap(description, &newTapID)
    guard tapErr == noErr, newTapID != AudioObjectID(kAudioObjectUnknown) else {
      throw TapRecorderError("tap_create_failed_\(tapErr)")
    }
    tapID = newTapID

    var format = try readTapFormat(tapID)
    /** 同一输出设备下格式不应漂移;万一变化(如 update 恰逢设备切换)记日志,buffer 自带格式描述仍可写入 */
    if let previous = tapFormat,
       previous.mSampleRate != format.mSampleRate || previous.mChannelsPerFrame != format.mChannelsPerFrame {
      log("tap format changed: \(previous.mSampleRate)Hz/\(previous.mChannelsPerFrame)ch → \(format.mSampleRate)Hz/\(format.mChannelsPerFrame)ch")
    }
    tapFormat = format

    var formatDescription: CMAudioFormatDescription?
    let fmtErr = CMAudioFormatDescriptionCreate(
      allocator: kCFAllocatorDefault,
      asbd: &format,
      layoutSize: 0,
      layout: nil,
      magicCookieSize: 0,
      magicCookie: nil,
      extensions: nil,
      formatDescriptionOut: &formatDescription
    )
    guard fmtErr == noErr, let formatDescription else {
      throw TapRecorderError("tap_format_description_failed_\(fmtErr)")
    }
    tapFormatDescription = formatDescription

    try createAggregateDevice(tapUUID: description.uuid)
  }

  func pause() {
    guard writer != nil, !paused else { return }
    paused = true
    pausedAt = Date()
    pauseStartHostTime = CMClockGetTime(CMClockGetHostTimeClock())
    emitStatus("paused", path: outputPath)
  }

  func resume() {
    guard writer != nil, paused else { return }
    if let pa = pausedAt {
      totalPausedDuration += Date().timeIntervalSince(pa)
      pausedAt = nil
    }
    if let pauseStart = pauseStartHostTime {
      pauseOffset = CMTimeAdd(pauseOffset, CMTimeSubtract(CMClockGetTime(CMClockGetHostTimeClock()), pauseStart))
      pauseStartHostTime = nil
    }
    paused = false
    lastSampleAt = Date()
    if !sessionStarted {
      startFirstSampleWatchdog()
    }
    startSampleGapWatchdog()
    emitStatus("recording", path: outputPath)
  }

  func stop() async {
    guard writer != nil else {
      emitError("not_recording")
      return
    }
    guard !isFinalizingRecording else { return }
    isFinalizingRecording = true
    defer { isFinalizingRecording = false }

    if paused, let pa = pausedAt {
      totalPausedDuration += Date().timeIntervalSince(pa)
    }

    /** 必须在拆管线前快照:stopCapturePipeline → detachMic 会把 micActive 清为 false,
     * 事后再读恒为 false,零样本收尾会把 mic 采集故障误报成「无音频内容」 */
    let hadMicAtStop = micActive

    stopCapturePipeline()
    /** 排空采样队列里已入队的回调,避免 markAsFinished 后再 append 抛 ObjC 异常 */
    sampleQueue.sync {}

    systemInput?.markAsFinished()
    micInput?.markAsFinished()

    if let writer, writer.status == .writing {
      await writer.finishWriting()
    }
    let writerStatus = writer?.status
    let writerError = describeError(writer?.error)
    let didWriteSamples = sessionStarted && (sysAppendCount + micAppendCount) > 0
    if let writer, writer.status == .failed {
      log("tap: writer finish failed: \(writerError)")
    }
    let stats = "tapCb=\(tapCallbackCount) sysOK=\(sysAppendCount) sysDrop=\(sysDropCount) micCb=\(micCallbackCount) micConvFail=\(micConvertFailCount) micOK=\(micAppendCount) micDrop=\(micDropCount)"
    log("tap stats: \(stats) devices: \(describeDefaultAudioDevices())")

    let elapsed = startTime.map { Date().timeIntervalSince($0) } ?? 0
    let duration = max(0, elapsed - totalPausedDuration)
    let savedPath = outputPath

    cleanup()

    if !didWriteSamples {
      log("tap: writer finish failed: no audio samples")
      try? FileManager.default.removeItem(atPath: savedPath)
      let error = hadMicAtStop ? "no_audio_samples" : "no_audio_content"
      emitError(error, detail: stats)
      return
    }

    if writerStatus != .completed {
      log("tap: writer finish failed: status=\(writerStatus?.rawValue ?? -1) error=\(writerError)")
      try? FileManager.default.removeItem(atPath: savedPath)
      emitError("writer_failed", detail: writerError)
      return
    }

    /**
     * 两轨恒预建,mixTracks 内部过滤零时长轨后按非空轨数产出单轨（纯系统 / 纯 mic / 混音统一收口）——
     * 音源可录音中任意增减，收尾无需再判断「有没有 mic」
     */
    emitStatus("mixing", path: savedPath)
    let mixed = await mixTracks(inputPath: savedPath)
    if !mixed {
      log("mixTracks failed, keeping original file")
    }

    emitStatus("stopped", path: savedPath, duration: duration)
  }

  private func startFirstSampleWatchdog() {
    firstSampleErrorEmitted = false
    let token = UUID()
    firstSampleWatchdogToken = token

    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + FIRST_AUDIO_SAMPLE_TIMEOUT) { [weak self] in
      guard let self else { return }

      self.sampleQueue.async { [weak self] in
        guard let self else { return }
        guard self.firstSampleWatchdogToken == token,
              self.writer != nil,
              self.micActive,
              !self.paused,
              !self.sessionStarted,
              !self.firstSampleErrorEmitted
        else { return }

        self.firstSampleErrorEmitted = true
        log("tap: first audio sample timeout")
        emitError("no_audio_samples", detail: "no first sample within \(Int(FIRST_AUDIO_SAMPLE_TIMEOUT))s, devices: \(describeDefaultAudioDevices())")
      }
    }
  }

  private func startSampleGapWatchdog() {
    sampleGapErrorEmitted = false
    let token = UUID()
    sampleGapWatchdogToken = token
    scheduleSampleGapWatchdog(token)
  }

  private func scheduleSampleGapWatchdog(_ token: UUID) {
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + AUDIO_SAMPLE_GAP_WATCHDOG_INTERVAL) { [weak self] in
      guard let self else { return }

      self.sampleQueue.async { [weak self] in
        guard let self else { return }
        guard self.sampleGapWatchdogToken == token,
              self.writer != nil
        else { return }

        if !self.paused,
           self.micActive,
           let lastSampleAt = self.lastSampleAt,
           Date().timeIntervalSince(lastSampleAt) >= AUDIO_SAMPLE_GAP_TIMEOUT,
           !self.sampleGapErrorEmitted {
          self.sampleGapErrorEmitted = true
          let gap = Int(Date().timeIntervalSince(lastSampleAt))
          log("tap: audio sample gap timeout (gap=\(gap)s)")
          emitError("audio_sample_timeout", detail: "no samples for \(gap)s, sysOK=\(self.sysAppendCount) micOK=\(self.micAppendCount), devices: \(describeDefaultAudioDevices())")
          return
        }

        self.scheduleSampleGapWatchdog(token)
      }
    }
  }

  // ── 采集管线搭建 ──

  /**
   * pids 非空 → 仅混入这些进程(include);为空 → 全系统混音并排除 excludePids(exclude)。
   * translate 对「从未注册 CoreAudio」的进程会失败(实测结论):
   * include 模式全部失败才报错;exclude 模式静默跳过——没在出声的进程本就无需排除
   */
  private func makeTapDescription(pids: [pid_t], excludePids: [pid_t]) throws -> CATapDescription {
    let description: CATapDescription

    if pids.isEmpty {
      let excludeObjects = excludePids.compactMap { translatePIDToAudioObject($0) }
      description = CATapDescription(stereoGlobalTapButExcludeProcesses: excludeObjects)
    }
    else {
      let includeObjects = pids.compactMap { translatePIDToAudioObject($0) }
      guard !includeObjects.isEmpty else {
        throw TapRecorderError("tap_no_capturable_process")
      }
      if includeObjects.count < pids.count {
        log("tap: \(pids.count - includeObjects.count) pid(s) not registered with CoreAudio, skipped")
      }
      description = CATapDescription(stereoMixdownOfProcesses: includeObjects)
    }

    description.uuid = UUID()
    description.muteBehavior = .unmuted
    return description
  }

  private func translatePIDToAudioObject(_ pid: pid_t) -> AudioObjectID? {
    var address = AudioObjectPropertyAddress(
      mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    var qualifierPID = pid
    var objectID = AudioObjectID(kAudioObjectUnknown)
    var dataSize = UInt32(MemoryLayout<AudioObjectID>.size)
    let err = AudioObjectGetPropertyData(
      AudioObjectID(kAudioObjectSystemObject),
      &address,
      UInt32(MemoryLayout<pid_t>.size),
      &qualifierPID,
      &dataSize,
      &objectID
    )
    guard err == noErr, objectID != AudioObjectID(kAudioObjectUnknown) else {
      return nil
    }
    return objectID
  }

  private func readTapFormat(_ tap: AudioObjectID) throws -> AudioStreamBasicDescription {
    var address = AudioObjectPropertyAddress(
      mSelector: kAudioTapPropertyFormat,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    var asbd = AudioStreamBasicDescription()
    var dataSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    let err = AudioObjectGetPropertyData(tap, &address, 0, nil, &dataSize, &asbd)
    guard err == noErr else {
      throw TapRecorderError("tap_format_read_failed_\(err)")
    }
    return asbd
  }

  /** 以默认输出设备为 main sub-device 的私有聚合设备(AudioCap 配方),tap 经 TapList 挂入并开漂移补偿 */
  private func createAggregateDevice(tapUUID: UUID) throws {
    let outputUID = try readDefaultOutputDeviceUID()

    let desc: [String: Any] = [
      kAudioAggregateDeviceNameKey: "SystemAudio-Tap",
      kAudioAggregateDeviceUIDKey: UUID().uuidString,
      kAudioAggregateDeviceMainSubDeviceKey: outputUID,
      kAudioAggregateDeviceIsPrivateKey: true,
      kAudioAggregateDeviceIsStackedKey: false,
      kAudioAggregateDeviceTapAutoStartKey: true,
      kAudioAggregateDeviceSubDeviceListKey: [
        [kAudioSubDeviceUIDKey: outputUID],
      ],
      kAudioAggregateDeviceTapListKey: [
        [
          kAudioSubTapUIDKey: tapUUID.uuidString,
          kAudioSubTapDriftCompensationKey: true,
        ],
      ],
    ]

    var newAggregateID = AudioObjectID(kAudioObjectUnknown)
    let err = AudioHardwareCreateAggregateDevice(desc as CFDictionary, &newAggregateID)
    guard err == noErr, newAggregateID != AudioObjectID(kAudioObjectUnknown) else {
      throw TapRecorderError("tap_aggregate_failed_\(err)")
    }
    aggregateID = newAggregateID
  }

  private func readDefaultOutputDeviceUID() throws -> String {
    var address = AudioObjectPropertyAddress(
      mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    var deviceID = AudioObjectID(kAudioObjectUnknown)
    var dataSize = UInt32(MemoryLayout<AudioObjectID>.size)
    var err = AudioObjectGetPropertyData(
      AudioObjectID(kAudioObjectSystemObject),
      &address, 0, nil, &dataSize, &deviceID
    )
    guard err == noErr, deviceID != AudioObjectID(kAudioObjectUnknown) else {
      throw TapRecorderError("tap_default_output_failed_\(err)")
    }

    var uidAddress = AudioObjectPropertyAddress(
      mSelector: kAudioDevicePropertyDeviceUID,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    var uid: CFString = "" as CFString
    var uidSize = UInt32(MemoryLayout<CFString>.size)
    err = withUnsafeMutablePointer(to: &uid) { ptr in
      AudioObjectGetPropertyData(deviceID, &uidAddress, 0, nil, &uidSize, ptr)
    }
    guard err == noErr else {
      throw TapRecorderError("tap_device_uid_failed_\(err)")
    }
    return uid as String
  }

  /**
   * 系统音轨与 mic 轨**恒预建**(即使对应音源未开=零样本):AVAssetWriter 开写后不能再加轨,
   * 预建才支持「录音中热挂/卸 tap 与 mic」。零样本空轨由 mixTracks 零时长过滤剔除。
   * AAC 仅支持 8k~48k;tap 原生采样率跟随输出设备,罕见值(96k 等)与未挂 tap 的缺省均落 48k,写入器重采样
   */
  private func setupWriter(outputPath: String) throws {
    let url = URL(fileURLWithPath: outputPath)
    try? FileManager.default.removeItem(at: url)

    let w = try AVAssetWriter(outputURL: url, fileType: .m4a)

    let aacSampleRates: Set<Double> = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]
    let tapSampleRate = tapFormat?.mSampleRate ?? 48000
    let sampleRate = aacSampleRates.contains(tapSampleRate)
      ? tapSampleRate
      : 48000

    let sysInput = AVAssetWriterInput(mediaType: .audio, outputSettings: aacSystemAudioSettings(sampleRate: sampleRate), sourceFormatHint: tapFormatDescription)
    sysInput.expectsMediaDataInRealTime = true
    w.add(sysInput)

    let mInput = AVAssetWriterInput(mediaType: .audio, outputSettings: aacMicSettings())
    mInput.expectsMediaDataInRealTime = true
    w.add(mInput)

    w.startWriting()

    writer = w
    systemInput = sysInput
    micInput = mInput
    sessionStarted = false
  }

  /**
   * 起 mic 采集引擎（VPIO AEC 或裸采集）;mic 轨恒预建,此处只负责「开始进样」。
   *
   * 录音中热挂时:VPIO 启动会重配置输出设备,可能扰动正在跑的 tap——若实测有此问题,
   * 需改为「tap 正跑时挂 mic 强制走裸采集」或「重挂 tap」策略。返回是否成功挂上
   */
  @discardableResult
  private func attachMic(aec: Bool) -> Bool {
    guard !micActive else { return true }
    guard prepareMicCapture(aec: aec) else { return false }

    /** VPIO 路径 captureSession 为 nil(无操作);裸采集路径在此启动 */
    captureSession?.startRunning()
    micActive = true
    /** 重挂 mic 后重置 gap 基准:关麦超 30s 再开麦时,陈旧时间戳会让下一个 tick 抢在新引擎首帧前误报 audio_sample_timeout */
    lastSampleAt = Date()
    return true
  }

  /** 停 mic 采集引擎,micInput 保留(恒预建);已采集的 mic 样本仍在产物中 */
  private func detachMic() {
    guard micActive else { return }

    captureSession?.stopRunning()
    captureSession = nil

    if let engine = audioEngine {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
      audioEngine = nil
    }
    micFormatDescription = nil
    micActive = false
  }

  /**
   * mic 采集引擎选择:优先 AVAudioEngine voice processing(苹果 AEC——外放场景
   * 不把系统播放的声音回录进 mic 轨,对齐浏览器 getUserMedia echoCancellation 行为),
   * 不可用时降级裸 AVCaptureSession(无 AEC)
   */
  private func prepareMicCapture(aec: Bool) -> Bool {
    if aec, prepareVoiceProcessedMic() {
      return true
    }
    return prepareCaptureSessionMic()
  }

  private func prepareVoiceProcessedMic() -> Bool {
    let engine = AVAudioEngine()
    let input = engine.inputNode

    do {
      try input.setVoiceProcessingEnabled(true)
    }
    catch {
      log("tap: voice processing unavailable: \(error.localizedDescription)")
      return false
    }

    /** 正在录系统音频:禁止 VPIO 闪避其它 App 音量,否则混入的系统音轨会被压低 */
    input.voiceProcessingOtherAudioDuckingConfiguration
      = AVAudioVoiceProcessingOtherAudioDuckingConfiguration(enableAdvancedDucking: false, duckingLevel: .min)

    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      log("tap: voice processing mic format invalid, fallback to raw capture")
      return false
    }

    /** 格式恒定,预建 CMAudioFormatDescription 一次缓存:每 buffer 转换直接复用 */
    var asbd = format.streamDescription.pointee
    var micFmtDesc: CMAudioFormatDescription?
    guard CMAudioFormatDescriptionCreate(
      allocator: kCFAllocatorDefault,
      asbd: &asbd,
      layoutSize: 0,
      layout: nil,
      magicCookieSize: 0,
      magicCookie: nil,
      extensions: nil,
      formatDescriptionOut: &micFmtDesc
    ) == noErr, let micFmtDesc else {
      log("tap: mic format description failed, fallback to raw capture")
      return false
    }
    micFormatDescription = micFmtDesc

    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, when in
      self?.handleMicBuffer(buffer, at: when)
    }

    engine.prepare()
    do {
      try engine.start()
    }
    catch {
      input.removeTap(onBus: 0)
      log("tap: audio engine start failed: \(error.localizedDescription), fallback to raw capture")
      return false
    }

    audioEngine = engine
    log("tap: mic via voice-processed AVAudioEngine (\(Int(format.sampleRate))Hz/\(format.channelCount)ch)")
    return true
  }

  private func prepareCaptureSessionMic() -> Bool {
    guard let device = AVCaptureDevice.default(for: .audio) else {
      log("tap: no microphone device, system audio only")
      return false
    }

    do {
      let input = try AVCaptureDeviceInput(device: device)
      let session = AVCaptureSession()
      guard session.canAddInput(input) else {
        log("tap: cannot add mic input, system audio only")
        return false
      }
      session.addInput(input)

      let output = AVCaptureAudioDataOutput()
      output.setSampleBufferDelegate(self, queue: sampleQueue)
      guard session.canAddOutput(output) else {
        log("tap: cannot add mic output, system audio only")
        return false
      }
      session.addOutput(output)

      captureSession = session
      log("tap: mic via raw AVCaptureSession (no AEC)")
      return true
    }
    catch {
      log("tap: mic capture setup failed: \(error.localizedDescription), system audio only")
      return false
    }
  }

  private func startIOProc() throws {
    var err = AudioDeviceCreateIOProcIDWithBlock(&deviceProcID, aggregateID, sampleQueue) { [weak self] _, inInputData, inInputTime, _, _ in
      self?.handleTapBuffer(inInputData, inInputTime)
    }
    guard err == noErr, deviceProcID != nil else {
      throw TapRecorderError("tap_ioproc_failed_\(err)")
    }

    err = AudioDeviceStart(aggregateID, deviceProcID)
    guard err == noErr else {
      throw TapRecorderError("tap_start_failed_\(err)")
    }
  }

  // ── 采样回调 ──

  /**
   * tap PCM(AudioBufferList)→ CMSampleBuffer → 系统音轨;PTS 用 host time,与 mic 轨同时基。
   *
   * IOProc 的 ABL 含聚合设备全部输入流,不止 tap 一路:VPIO(mic AEC)开启时,
   * 输出子设备会多出一条回声参考流(实测 4ch,排在 tap 之前),必须按 tap 格式的
   * 声道数扫描定位 tap 流,固定取第一个 buffer 会拿到参考流并因尺寸不符全量丢样
   */
  private func handleTapBuffer(_ bufferList: UnsafePointer<AudioBufferList>, _ inputTime: UnsafePointer<AudioTimeStamp>) {
    tapCallbackCount += 1
    guard !paused else { return }
    guard let writer, writer.status == .writing,
          let formatDescription = tapFormatDescription,
          let format = tapFormat
    else { return }

    let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: bufferList))
    guard let tapBuffer = buffers.first(where: { $0.mNumberChannels == format.mChannelsPerFrame })
    else {
      if sysDropCount == 0 {
        let layout = buffers.map { "\($0.mNumberChannels)ch/\($0.mDataByteSize)B" }.joined(separator: ",")
        log("tap: no stream matches tap format \(format.mChannelsPerFrame)ch, abl=[\(layout)]")
      }
      sysDropCount += 1
      return
    }

    let bytesPerFrame = Int(format.mBytesPerFrame)
    guard bytesPerFrame > 0 else { return }

    let frameCount = Int(tapBuffer.mDataByteSize) / bytesPerFrame
    guard frameCount > 0 else { return }

    trackSilence(tapBuffer, format: format)

    var timing = CMSampleTimingInfo(
      duration: CMTime(value: 1, timescale: CMTimeScale(format.mSampleRate)),
      presentationTimeStamp: CMClockMakeHostTimeFromSystemUnits(inputTime.pointee.mHostTime),
      decodeTimeStamp: .invalid
    )

    var sampleBuffer: CMSampleBuffer?
    var status = CMSampleBufferCreate(
      allocator: kCFAllocatorDefault,
      dataBuffer: nil,
      dataReady: false,
      makeDataReadyCallback: nil,
      refcon: nil,
      formatDescription: formatDescription,
      sampleCount: frameCount,
      sampleTimingEntryCount: 1,
      sampleTimingArray: &timing,
      sampleSizeEntryCount: 0,
      sampleSizeArray: nil,
      sampleBufferOut: &sampleBuffer
    )
    guard status == noErr, let sampleBuffer else {
      if sysDropCount == 0 { log("tap: CMSampleBufferCreate failed \(status)") }
      sysDropCount += 1
      return
    }

    /** 只喂 tap 这一路:参考流等其它输入流不进产物 */
    var tapOnlyList = AudioBufferList(mNumberBuffers: 1, mBuffers: tapBuffer)
    status = CMSampleBufferSetDataBufferFromAudioBufferList(
      sampleBuffer,
      blockBufferAllocator: kCFAllocatorDefault,
      blockBufferMemoryAllocator: kCFAllocatorDefault,
      flags: 0,
      bufferList: &tapOnlyList
    )
    guard status == noErr else {
      if sysDropCount == 0 { log("tap: SetDataBufferFromAudioBufferList failed \(status)") }
      sysDropCount += 1
      return
    }

    appendSample(sampleBuffer, to: systemInput)
  }

  /** mic 轨(降级路径):AVCaptureSession 回调(与 tap 同队列串行) */
  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard !paused, sampleBuffer.isValid else { return }
    appendSample(sampleBuffer, to: micInput)
  }

  /** mic 轨(VPIO 路径):AVAudioEngine tap 回调在引擎内部线程,拷贝为 CMSampleBuffer 后进采样串行队列 */
  private func handleMicBuffer(_ buffer: AVAudioPCMBuffer, at when: AVAudioTime) {
    micCallbackCount += 1
    guard !paused, buffer.frameLength > 0 else { return }
    guard let sampleBuffer = makeSampleBuffer(from: buffer, at: when) else {
      micConvertFailCount += 1
      return
    }

    sampleQueue.async { [weak self] in
      guard let self else { return }
      self.appendSample(sampleBuffer, to: self.micInput)
    }
  }

  /** PTS 取 AVAudioTime 的 host time,与 tap / AVCapture 同时基,两轨天然对齐 */
  private func makeSampleBuffer(from buffer: AVAudioPCMBuffer, at when: AVAudioTime) -> CMSampleBuffer? {
    guard let formatDescription = micFormatDescription else { return nil }

    let pts = when.isHostTimeValid
      ? CMClockMakeHostTimeFromSystemUnits(when.hostTime)
      : CMClockGetTime(CMClockGetHostTimeClock())

    var timing = CMSampleTimingInfo(
      duration: CMTime(value: 1, timescale: CMTimeScale(buffer.format.sampleRate)),
      presentationTimeStamp: pts,
      decodeTimeStamp: .invalid
    )

    var sampleBuffer: CMSampleBuffer?
    guard CMSampleBufferCreate(
      allocator: kCFAllocatorDefault,
      dataBuffer: nil,
      dataReady: false,
      makeDataReadyCallback: nil,
      refcon: nil,
      formatDescription: formatDescription,
      sampleCount: CMItemCount(buffer.frameLength),
      sampleTimingEntryCount: 1,
      sampleTimingArray: &timing,
      sampleSizeEntryCount: 0,
      sampleSizeArray: nil,
      sampleBufferOut: &sampleBuffer
    ) == noErr, let sampleBuffer else { return nil }

    guard CMSampleBufferSetDataBufferFromAudioBufferList(
      sampleBuffer,
      blockBufferAllocator: kCFAllocatorDefault,
      blockBufferMemoryAllocator: kCFAllocatorDefault,
      flags: 0,
      bufferList: buffer.audioBufferList
    ) == noErr else { return nil }

    return sampleBuffer
  }

  private func appendSample(_ sampleBuffer: CMSampleBuffer, to input: AVAssetWriterInput?) {
    guard let writer, writer.status == .writing else { return }

    /** 暂停时段从时间轴剔除:两轨样本 PTS 统一回拨 pauseOffset,保持相互对齐 */
    let adjusted = retimedForPauseOffset(sampleBuffer)

    if !sessionStarted {
      writer.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(adjusted))
      sessionStarted = true
    }

    if let input, input.isReadyForMoreMediaData {
      let appended = input.append(adjusted)
      if !appended {
        log("append failed (\(input === systemInput ? "system" : "mic")): \(writer.error?.localizedDescription ?? "unknown")")
        return
      }
      if input === systemInput {
        sysAppendCount += 1
      }
      else {
        micAppendCount += 1
      }
      lastSampleAt = Date()
    }
    else if input === systemInput {
      sysDropCount += 1
    }
    else {
      micDropCount += 1
    }
  }

  private func retimedForPauseOffset(_ sampleBuffer: CMSampleBuffer) -> CMSampleBuffer {
    guard pauseOffset != .zero else { return sampleBuffer }

    var timing = CMSampleTimingInfo()
    guard CMSampleBufferGetSampleTimingInfo(sampleBuffer, at: 0, timingInfoOut: &timing) == noErr else {
      return sampleBuffer
    }
    timing.presentationTimeStamp = CMTimeSubtract(timing.presentationTimeStamp, pauseOffset)
    timing.decodeTimeStamp = .invalid

    var retimed: CMSampleBuffer?
    let status = CMSampleBufferCreateCopyWithNewTiming(
      allocator: kCFAllocatorDefault,
      sampleBuffer: sampleBuffer,
      sampleTimingEntryCount: 1,
      sampleTimingArray: &timing,
      sampleBufferOut: &retimed
    )
    guard status == noErr, let retimed else { return sampleBuffer }
    return retimed
  }

  private func trackSilence(_ buffer: AudioBuffer, format: AudioStreamBasicDescription) {
    guard !receivedNonSilentBuffer,
          format.mFormatFlags & kAudioFormatFlagIsFloat != 0,
          let data = buffer.mData
    else { return }

    let floats = data.assumingMemoryBound(to: Float32.self)
    let sampleCount = min(64, Int(buffer.mDataByteSize) / MemoryLayout<Float32>.size)
    for i in 0..<sampleCount where abs(floats[i]) > 1e-6 {
      receivedNonSilentBuffer = true
      return
    }

    silentBufferCount += 1
    if silentBufferCount == 1000 {
      log("tap: 1000 consecutive silent buffers - check System Audio Recording permission or source app volume")
    }
  }

  // ── 拆除与清理 ──

  /** 拆除顺序固定:AudioDeviceStop → DestroyIOProcID → DestroyAggregateDevice → DestroyProcessTap */
  private func teardownTapPipeline() {
    if aggregateID != AudioObjectID(kAudioObjectUnknown) {
      if let procID = deviceProcID {
        AudioDeviceStop(aggregateID, procID)
        AudioDeviceDestroyIOProcID(aggregateID, procID)
      }
      AudioHardwareDestroyAggregateDevice(aggregateID)
    }
    if tapID != AudioObjectID(kAudioObjectUnknown) {
      AudioHardwareDestroyProcessTap(tapID)
    }
    deviceProcID = nil
    aggregateID = AudioObjectID(kAudioObjectUnknown)
    tapID = AudioObjectID(kAudioObjectUnknown)
  }

  private func stopCapturePipeline() {
    teardownTapPipeline()
    tapActive = false
    detachMic()
  }

  private func cleanup() {
    stopCapturePipeline()
    writer = nil
    systemInput = nil
    micInput = nil
    micAecPref = true
    paused = false
    startTime = nil
    totalPausedDuration = 0
    pausedAt = nil
    pauseOffset = .zero
    pauseStartHostTime = nil
    sessionStarted = false
    firstSampleWatchdogToken = UUID()
    firstSampleErrorEmitted = false
    sampleGapWatchdogToken = UUID()
    sampleGapErrorEmitted = false
    lastSampleAt = nil
    tapFormat = nil
    tapFormatDescription = nil
    micFormatDescription = nil
    receivedNonSilentBuffer = false
    silentBufferCount = 0
    tapCallbackCount = 0
    sysAppendCount = 0
    sysDropCount = 0
    micCallbackCount = 0
    micConvertFailCount = 0
    micAppendCount = 0
    micDropCount = 0
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

/**
 * stop 收尾(排空采样队列 + finishWriting + mixTracks)进行中标记。
 *
 * 所有退出路径(SIGTERM / 父进程死亡 / stdin 关闭)必须等收尾完成再 exit,
 * 否则混音写到一半被杀:_mix_ 临时件(无 moov 不可播)与未混音双轨原件双双残留恢复目录。
 * 兼作 stop 重入护栏(stop 命令与 SIGTERM 并发时防双重 finishWriting)
 */
var isFinalizingRecording = false

func waitForRecordingFinalize(maxSeconds: Double = 15) async {
  let deadline = Date().addingTimeInterval(maxSeconds)
  while isFinalizingRecording && Date() < deadline {
    try? await Task.sleep(nanoseconds: 100_000_000)
  }
}

// MARK: - 命令派发与进程生命周期

let recorder = Recorder()

/**
 * 命令串行链:所有 stdin 命令与退出收尾逐条 await 前一条完成,杜绝交错。
 *
 * handleCommand 原先每条命令起独立 Task,并发时会互相踩:两个 start 交错会把
 * activeEngine 清零留下僵尸 tap;update 与 stop 交错会对同一批 CoreAudio 对象
 * 双重销毁(潜在崩溃)。commandChainQueue 仅护尾指针,命令本体仍异步串行执行。
 */
let commandChainQueue = DispatchQueue(label: "audio-recorder-command-chain")
var commandTail: Task<Void, Never> = Task {}

func enqueueCommand(_ work: @escaping () async -> Void) {
  commandChainQueue.sync {
    let previous = commandTail
    commandTail = Task {
      await previous.value
      await work()
    }
  }
}

/** TapRecorder 是 @available(macOS 14.2, *) 类,全局 let 不能带可用性标注,用惰性持有器绕开 */
var tapRecorderStorage: AnyObject?

@available(macOS 14.2, *)
func sharedTapRecorder() -> TapRecorder {
  if let existing = tapRecorderStorage as? TapRecorder {
    return existing
  }
  let created = TapRecorder()
  tapRecorderStorage = created
  return created
}

/** 两个引擎共用一个子进程,同一时刻只允许一路录音;stop/pause/resume 按此路由 */
enum ActiveEngine {
  case none
  case sck
  case tap
}

var activeEngine: ActiveEngine = .none

func stopActiveRecorder() async {
  if activeEngine == .tap, #available(macOS 14.2, *) {
    await sharedTapRecorder().stop()
  }
  else {
    await recorder.stop()
  }
  activeEngine = .none
}

func handleCommand(_ line: String) async {
  guard let data = line.data(using: .utf8),
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let action = json["action"] as? String
  else { return }

  switch action {
  case "start":
    guard activeEngine == .none else {
      emitError("already_recording")
      return
    }

    let outputPath = json["outputPath"] as? String ?? "/tmp/audio-recording-\(Int(Date().timeIntervalSince1970)).m4a"

    if json["engine"] as? String == "tap" {
      guard #available(macOS 14.2, *) else {
        emitError("tap_requires_macos_14_2")
        return
      }

      let pids = (json["pids"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.int32Value }
      let excludePids = (json["excludePids"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.int32Value }
      let mic = json["mic"] as? Bool ?? true
      let tapEnabled = json["tapEnabled"] as? Bool ?? true
      let micAec = json["micAec"] as? Bool ?? true

      activeEngine = .tap
      let started = await sharedTapRecorder().start(
        outputPath: outputPath,
        pids: pids,
        excludePids: excludePids,
        withMic: mic,
        tapEnabled: tapEnabled,
        micAec: micAec
      )
      if !started {
        activeEngine = .none
      }
    }
    else {
      activeEngine = .sck
      let started = await recorder.start(outputPath: outputPath)
      if !started {
        activeEngine = .none
      }
    }
  case "update":
    /** 仅 tap 引擎支持录音中热挂/卸音源(mic 与系统音轨)与变更进程集合;SCK 会议链路无此语义 */
    if activeEngine == .tap, #available(macOS 14.2, *) {
      let tapEnabled = json["tapEnabled"] as? Bool ?? true
      let micEnabled = json["micEnabled"] as? Bool ?? true
      let pids = (json["pids"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.int32Value }
      let excludePids = (json["excludePids"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.int32Value }
      sharedTapRecorder().update(tapEnabled: tapEnabled, micEnabled: micEnabled, pids: pids, excludePids: excludePids)
    }
  case "pause":
    if activeEngine == .tap, #available(macOS 14.2, *) {
      sharedTapRecorder().pause()
    }
    else {
      recorder.pause()
    }
  case "resume":
    if activeEngine == .tap, #available(macOS 14.2, *) {
      sharedTapRecorder().resume()
    }
    else {
      recorder.resume()
    }
  case "stop":
    await stopActiveRecorder()
  default:
    break
  }
}

var finalizeRequested = false

/** 退出收尾:经命令链串到在飞命令之后再停录并退出,避免与在飞 start/update 交错 */
func finalizeAndExit() {
  /**
   * 硬退出看门狗(独立于命令链):前驱命令的 finishWriting / mixTracks 万一挂起,
   * `await previous.value` 会永久阻塞,exit 永不到达→僵尸进程占着音频设备不退。
   * 首次触发即武装,20s 兜底强退(> waitForRecordingFinalize 的 15s,正常收尾先自然退出)
   */
  commandChainQueue.sync {
    guard !finalizeRequested else { return }
    finalizeRequested = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
      log("finalize watchdog fired, forcing exit")
      exit(0)
    }
  }

  enqueueCommand {
    await stopActiveRecorder()
    await waitForRecordingFinalize()
    exit(0)
  }
}

// SIGTERM → 优雅停止录制再退出（NativeBridge.stop() 发 SIGTERM）
let sigTermSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
signal(SIGTERM, SIG_IGN)
sigTermSource.setEventHandler {
  finalizeAndExit()
}
sigTermSource.resume()

// 检测父进程存活
let parentCheckTimer = DispatchSource.makeTimerSource(queue: .main)
parentCheckTimer.schedule(deadline: .now() + 3, repeating: 3)
parentCheckTimer.setEventHandler {
  if getppid() == 1 {
    finalizeAndExit()
  }
}
parentCheckTimer.resume()

// 读 stdin（阻塞，放后台线程）
DispatchQueue.global(qos: .userInitiated).async {
  while let line = readLine() {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { continue }
    enqueueCommand { await handleCommand(trimmed) }
  }
  // stdin 关闭 = 父进程退出;等收尾(含 mixTracks)完成再退,避免混音临时件残留
  finalizeAndExit()
}

CFRunLoopRun()

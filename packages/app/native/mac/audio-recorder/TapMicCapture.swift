// 封装 tap 引擎的三级物理麦克风采集与 PCM 回调

import AVFoundation
import CoreMedia

/**
 * tap 引擎的物理麦克风采集器
 *
 * 这里只负责创建、探测和销毁三种 macOS 采集路径，并把已经拷贝到自有内存的
 * PCM buffer 交给 TapRecorder。它不关心 sidecar、混音、恢复策略或录音状态。
 * 所有输出最终都串行投递到 sampleQueue，调用方可以安全写入 sidecar
 */
@available(macOS 14.2, *)
final class TapMicCapture: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
  private enum EnginePrepareResult {
    case ready
    case retryableFailure
    case finalFailure
  }

  typealias SampleHandler = (AVAudioPCMBuffer, CMTime) -> Void

  private let sampleQueue: DispatchQueue
  private let captureCallbackQueue = DispatchQueue(
    label: "tap-recorder-avcapture-callback",
    qos: .userInitiated
  )
  private let sampleHandler: SampleHandler
  /** attach/detach 不能与下一代物理管线并发，失效 generation 本身仍可在锁外即时发生 */
  private let lifecycleLock = NSLock()
  private let generationLock = NSLock()
  private var activeGeneration: UUID?
  private var activeCaptureOutput: AVCaptureOutput?
  private var activeCaptureProbeToken: UUID?
  private var active = false
  private let statsLock = NSLock()
  private var callbackCountStorage = 0
  private var successfulSampleProbeTokens: Set<UUID> = []
  private var convertFailCountStorage = 0

  private var captureSession: AVCaptureSession?
  private var audioEngine: AVAudioEngine?

  init(sampleQueue: DispatchQueue, onSample: @escaping SampleHandler) {
    self.sampleQueue = sampleQueue
    self.sampleHandler = onSample
    super.init()
  }

  var isActive: Bool {
    generationLock.lock()
    defer { generationLock.unlock() }
    return active
  }

  var callbackCount: Int {
    statsLock.lock()
    defer { statsLock.unlock() }
    return callbackCountStorage
  }

  var convertFailCount: Int {
    statsLock.lock()
    defer { statsLock.unlock() }
    return convertFailCountStorage
  }

  func resetStatistics() {
    statsLock.lock()
    callbackCountStorage = 0
    successfulSampleProbeTokens = []
    convertFailCountStorage = 0
    statsLock.unlock()
  }

  /** 按 VPIO → 裸 AVAudioEngine → AVCaptureSession 的顺序挂载物理输入 */
  @discardableResult
  func attach(aec: Bool) -> UUID? {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }

    if isActive {
      return activeGenerationToken
    }

    let generation = UUID()
    generationLock.lock()
    activeGeneration = generation
    activeCaptureOutput = nil
    activeCaptureProbeToken = nil
    active = false
    generationLock.unlock()

    guard prepareMicCapture(aec: aec, generation: generation) else {
      invalidateGeneration()
      return nil
    }

    generationLock.lock()
    guard activeGeneration == generation else {
      generationLock.unlock()
      stopPhysicalResources()
      return nil
    }
    active = true
    generationLock.unlock()
    return generation
  }

  /** 停止物理输入并排空已经投递到 sampleQueue 的 PCM callback */
  func detach() {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
    invalidateGeneration()
    stopPhysicalResources()
  }

  /** 只拆除调用方创建的那一代，避免 stale recovery 拆掉下一代 mic */
  func detach(ifCurrentGeneration generation: UUID) {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
    guard invalidateGeneration(ifMatching: generation) else { return }
    stopPhysicalResources()
  }

  private func stopPhysicalResources() {
    captureSession?.stopRunning()
    captureSession = nil

    if let engine = audioEngine {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
      audioEngine = nil
    }

    sampleQueue.sync {}
  }

  /** stop 的 terminal 路径不拆 Core Audio，只让迟到 callback 失效 */
  func invalidateGeneration() {
    _ = invalidateGeneration(ifMatching: nil)
  }

  private func invalidateGeneration(ifMatching expectedGeneration: UUID?) -> Bool {
    generationLock.lock()
    guard expectedGeneration == nil || activeGeneration == expectedGeneration else {
      generationLock.unlock()
      return false
    }
    activeGeneration = nil
    activeCaptureOutput = nil
    activeCaptureProbeToken = nil
    active = false
    generationLock.unlock()
    return true
  }

  var activeGenerationToken: UUID? {
    generationLock.lock()
    defer { generationLock.unlock() }
    return activeGeneration
  }

  private func prepareMicCapture(aec: Bool, generation: UUID) -> Bool {
    guard isCurrent(generation) else { return false }
    if aec, prepareVoiceProcessedMic(generation: generation) {
      return true
    }
    guard isCurrent(generation) else { return false }
    if prepareRawAudioEngineMicWithRetry(generation: generation) {
      return true
    }
    guard isCurrent(generation) else { return false }
    return prepareCaptureSessionMic(generation: generation)
  }

  private func prepareRawAudioEngineMicWithRetry(generation: UUID) -> Bool {
    for attempt in 1...RAW_AUDIO_ENGINE_START_ATTEMPTS {
      guard isCurrent(generation) else { return false }
      switch prepareRawAudioEngineMic(generation: generation) {
      case .ready:
        return true

      case .finalFailure:
        return false

      case .retryableFailure:
        guard attempt < RAW_AUDIO_ENGINE_START_ATTEMPTS else {
          log("tap: raw audio engine start failed after \(RAW_AUDIO_ENGINE_START_ATTEMPTS) attempts, fallback to AVCaptureSession")
          return false
        }

        log("tap: raw audio engine retry \(attempt + 1)/\(RAW_AUDIO_ENGINE_START_ATTEMPTS) after transient start failure")
        Thread.sleep(forTimeInterval: RAW_AUDIO_ENGINE_RETRY_DELAY_SEC)
        guard isCurrent(generation) else { return false }
      }
    }

    return false
  }

  private func prepareVoiceProcessedMic(generation: UUID) -> Bool {
    guard isCurrent(generation) else { return false }
    let engine = AVAudioEngine()
    let input = engine.inputNode

    do {
      try input.setVoiceProcessingEnabled(true)
      input.isVoiceProcessingBypassed = false
      input.isVoiceProcessingAGCEnabled = true
    }
    catch {
      log("tap: voice processing unavailable: \(error.localizedDescription)")
      releaseVoiceProcessingMic(input: input, engine: engine)
      return false
    }

    /** 正在录系统音频：禁止 VPIO 闪避其它 App 音量，否则混入的系统音轨会被压低 */
    input.voiceProcessingOtherAudioDuckingConfiguration
      = AVAudioVoiceProcessingOtherAudioDuckingConfiguration(enableAdvancedDucking: false, duckingLevel: .min)

    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      log("tap: voice processing mic format invalid, fallback to raw capture")
      releaseVoiceProcessingMic(input: input, engine: engine)
      return false
    }
    /** Apple 没有公开 VPIO 多声道布局语义，未知布局不能猜测声道 */
    guard format.channelCount <= 2 else {
      log("tap: voice processing mic format \(format.channelCount)ch has no stable channel semantics, fallback to raw capture")
      releaseVoiceProcessingMic(input: input, engine: engine)
      return false
    }

    guard isCurrent(generation) else {
      releaseVoiceProcessingMic(input: input, engine: engine)
      return false
    }

    let sampleProbeToken = UUID()
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      self?.handleMicBuffer(
        buffer,
        generation: generation,
        sampleProbeToken: sampleProbeToken
      )
    }

    engine.prepare()
    do {
      try engine.start()
    }
    catch {
      input.removeTap(onBus: 0)
      releaseVoiceProcessingMic(input: input, engine: engine)
      log("tap: audio engine start failed: \(error.localizedDescription), fallback to raw capture")
      return false
    }

    guard isCurrent(generation) else {
      input.removeTap(onBus: 0)
      releaseVoiceProcessingMic(input: input, engine: engine)
      return false
    }

    guard waitForFirstMicSample(
      sampleProbeToken: sampleProbeToken,
      label: "voice-processed audio engine",
      generation: generation
    ) else {
      input.removeTap(onBus: 0)
      releaseVoiceProcessingMic(input: input, engine: engine)
      log("tap: voice-processed audio engine started but no samples in \(Int(MIC_FIRST_SAMPLE_PROBE_TIMEOUT_SEC * 1000))ms, fallback to raw capture")
      return false
    }

    guard isCurrent(generation) else {
      input.removeTap(onBus: 0)
      releaseVoiceProcessingMic(input: input, engine: engine)
      return false
    }

    audioEngine = engine
    log("tap: mic via voice-processed AVAudioEngine (\(Int(format.sampleRate))Hz/\(format.channelCount)ch, AGC=\(input.isVoiceProcessingAGCEnabled), bypass=\(input.isVoiceProcessingBypassed))")
    return true
  }

  private func prepareRawAudioEngineMic(generation: UUID) -> EnginePrepareResult {
    guard isCurrent(generation) else { return .finalFailure }
    let engine = AVAudioEngine()
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      log("tap: raw audio engine mic format invalid, fallback to AVCaptureSession")
      return .finalFailure
    }
    guard format.channelCount <= 2 else {
      log("tap: raw audio engine mic format \(format.channelCount)ch is not writer-compatible, fallback to AVCaptureSession")
      return .finalFailure
    }

    let sampleProbeToken = UUID()
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      self?.handleMicBuffer(
        buffer,
        generation: generation,
        sampleProbeToken: sampleProbeToken
      )
    }

    engine.prepare()
    do {
      try engine.start()
    }
    catch {
      input.removeTap(onBus: 0)
      log("tap: raw audio engine start failed: \(describeError(error))")
      return .retryableFailure
    }

    guard isCurrent(generation) else {
      input.removeTap(onBus: 0)
      engine.stop()
      return .finalFailure
    }

    guard waitForFirstMicSample(
      sampleProbeToken: sampleProbeToken,
      label: "raw audio engine",
      generation: generation
    ) else {
      input.removeTap(onBus: 0)
      engine.stop()
      log("tap: raw audio engine started but no samples in \(Int(MIC_FIRST_SAMPLE_PROBE_TIMEOUT_SEC * 1000))ms, treating as transient failure")
      return .retryableFailure
    }

    guard isCurrent(generation) else {
      input.removeTap(onBus: 0)
      engine.stop()
      return .finalFailure
    }

    audioEngine = engine
    log("tap: mic via raw AVAudioEngine (\(Int(format.sampleRate))Hz/\(format.channelCount)ch, no AEC)")
    return .ready
  }

  private func prepareCaptureSessionMic(generation: UUID) -> Bool {
    guard isCurrent(generation) else { return false }
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
      output.setSampleBufferDelegate(self, queue: captureCallbackQueue)
      guard session.canAddOutput(output) else {
        log("tap: cannot add mic output, system audio only")
        return false
      }
      session.addOutput(output)
      let sampleProbeToken = UUID()
      registerCaptureOutput(
        output,
        generation: generation,
        sampleProbeToken: sampleProbeToken
      )

      guard isCurrent(generation) else {
        output.setSampleBufferDelegate(nil, queue: nil)
        clearCaptureOutput(for: generation)
        return false
      }

      session.startRunning()
      guard waitForFirstMicSample(
        sampleProbeToken: sampleProbeToken,
        label: "AVCaptureSession",
        generation: generation
      ) else {
        session.stopRunning()
        output.setSampleBufferDelegate(nil, queue: nil)
        clearCaptureOutput(for: generation)
        log("tap: AVCaptureSession started but no samples in \(Int(MIC_FIRST_SAMPLE_PROBE_TIMEOUT_SEC * 1000))ms, system audio only")
        return false
      }

      guard isCurrent(generation) else {
        session.stopRunning()
        output.setSampleBufferDelegate(nil, queue: nil)
        clearCaptureOutput(for: generation)
        return false
      }

      captureSession = session
      log("tap: mic via raw AVCaptureSession (no AEC)")
      return true
    }
    catch {
      log("tap: mic capture setup failed: \(error.localizedDescription), system audio only")
      return false
    }
  }

  private func releaseVoiceProcessingMic(input: AVAudioInputNode, engine: AVAudioEngine) {
    try? input.setVoiceProcessingEnabled(false)
    engine.stop()
  }

  private func waitForFirstMicSample(
    sampleProbeToken: UUID,
    label: String,
    generation: UUID
  ) -> Bool {
    let deadline = Date().addingTimeInterval(MIC_FIRST_SAMPLE_PROBE_TIMEOUT_SEC)
    while Date() < deadline {
      guard isCurrent(generation) else { return false }
      if hasSuccessfulSample(for: sampleProbeToken) {
        return true
      }
      Thread.sleep(forTimeInterval: MIC_FIRST_SAMPLE_PROBE_INTERVAL_SEC)
    }

    if isCurrent(generation), hasSuccessfulSample(for: sampleProbeToken) {
      return true
    }

    log("tap: \(label) produced no usable mic samples during first-sample probe")
    return false
  }

  private func handleMicBuffer(
    _ buffer: AVAudioPCMBuffer,
    generation: UUID,
    sampleProbeToken: UUID
  ) {
    guard isCurrent(generation), buffer.frameLength > 0 else { return }
    /** 先取 helper host clock，避免高负载下拷贝 PCM 的耗时污染样本时间轴 */
    let captureHostTime = CMClockGetTime(CMClockGetHostTimeClock())
    incrementCallbackCount()
    guard let copied = copyPCMBuffer(buffer) else {
      incrementConvertFailCount()
      return
    }
    markSuccessfulSample(for: sampleProbeToken)

    sampleQueue.async { [weak self] in
      guard let self, self.isCurrent(generation) else { return }
      self.sampleHandler(copied, captureHostTime)
    }
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let context = captureContext(for: output), sampleBuffer.isValid else { return }
    /** CMSampleBuffer 的 PTS 不保证与录音逻辑时钟同源，统一取 callback 入口的 host clock */
    let captureHostTime = CMClockGetTime(CMClockGetHostTimeClock())
    incrementCallbackCount()
    guard let pcmBuffer = copyPCMBuffer(from: sampleBuffer) else {
      incrementConvertFailCount()
      return
    }
    markSuccessfulSample(for: context.sampleProbeToken)

    sampleQueue.async { [weak self] in
      guard let self, self.isCurrent(context.generation) else { return }
      self.sampleHandler(pcmBuffer, captureHostTime)
    }
    _ = connection
  }

  private func isCurrent(_ generation: UUID) -> Bool {
    generationLock.lock()
    defer { generationLock.unlock() }
    return activeGeneration == generation
  }

  private func registerCaptureOutput(
    _ output: AVCaptureOutput,
    generation: UUID,
    sampleProbeToken: UUID
  ) {
    generationLock.lock()
    if activeGeneration == generation {
      activeCaptureOutput = output
      activeCaptureProbeToken = sampleProbeToken
    }
    generationLock.unlock()
  }

  private func clearCaptureOutput(for generation: UUID) {
    generationLock.lock()
    if activeGeneration == generation {
      activeCaptureOutput = nil
      activeCaptureProbeToken = nil
    }
    generationLock.unlock()
  }

  private func captureContext(
    for output: AVCaptureOutput
  ) -> (generation: UUID, sampleProbeToken: UUID)? {
    generationLock.lock()
    defer { generationLock.unlock() }
    guard activeCaptureOutput === output,
          let activeGeneration,
          let activeCaptureProbeToken else { return nil }
    return (activeGeneration, activeCaptureProbeToken)
  }

  private func incrementCallbackCount() {
    statsLock.lock()
    callbackCountStorage += 1
    statsLock.unlock()
  }

  private func hasSuccessfulSample(for sampleProbeToken: UUID) -> Bool {
    statsLock.lock()
    defer { statsLock.unlock() }
    return successfulSampleProbeTokens.contains(sampleProbeToken)
  }

  private func markSuccessfulSample(for sampleProbeToken: UUID) {
    statsLock.lock()
    successfulSampleProbeTokens.insert(sampleProbeToken)
    statsLock.unlock()
  }

  private func incrementConvertFailCount() {
    statsLock.lock()
    convertFailCountStorage += 1
    statsLock.unlock()
  }

  private func copyPCMBuffer(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    guard let copied = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else {
      return nil
    }
    copied.frameLength = buffer.frameLength

    let sourceBuffers = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
    let targetBuffers = UnsafeMutableAudioBufferListPointer(copied.mutableAudioBufferList)
    for index in 0..<min(sourceBuffers.count, targetBuffers.count) {
      guard let source = sourceBuffers[index].mData,
            let target = targetBuffers[index].mData
      else { continue }
      let byteCount = Int(sourceBuffers[index].mDataByteSize)
      memcpy(target, source, byteCount)
      targetBuffers[index].mDataByteSize = sourceBuffers[index].mDataByteSize
    }

    return copied
  }

  private func copyPCMBuffer(from sampleBuffer: CMSampleBuffer) -> AVAudioPCMBuffer? {
    guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
          let streamDescription = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription),
          let format = AVAudioFormat(streamDescription: streamDescription)
    else {
      if convertFailCount == 0 {
        log("tap: AVCapture PCM format unavailable")
      }
      return nil
    }

    let frameCount = CMSampleBufferGetNumSamples(sampleBuffer)
    guard frameCount > 0, frameCount <= Int(Int32.max) else {
      if convertFailCount == 0 {
        log("tap: AVCapture PCM frame count invalid: \(frameCount)")
      }
      return nil
    }

    guard let buffer = AVAudioPCMBuffer(
      pcmFormat: format,
      frameCapacity: AVAudioFrameCount(frameCount)
    ) else {
      if convertFailCount == 0 {
        log("tap: AVCapture PCM buffer allocation failed")
      }
      return nil
    }
    buffer.frameLength = AVAudioFrameCount(frameCount)

    let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
      sampleBuffer,
      at: 0,
      frameCount: Int32(frameCount),
      into: buffer.mutableAudioBufferList
    )
    guard status == noErr else {
      if convertFailCount == 0 {
        log("tap: AVCapture PCM copy failed \(status)")
      }
      return nil
    }

    return buffer
  }
}

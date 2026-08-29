// 封装 raw AVAudioEngine 与 AVCaptureSession 的物理麦克风采集和 PCM 回调

import AVFoundation
import AudioProcessing
import CoreMedia
import Darwin

/** 主进程可跨 helper 安全保留的麦克风采集路线提示。 */
enum MicCaptureStrategy: String {
  case rawAudioEngine
  case captureSession
}

/**
 * 物理麦克风采集器
 *
 * 这里刻意只启用 raw 采集：录音 helper 不向系统麦克风路线注入 AEC/NS/AGC
 * 音频处理由 AudioProcessing 模块在私有队列中完成
 * 采集 callback 只复制 PCM 并异步交给调用方，调用方负责 sidecar 和实时处理的生命周期
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
  private let lifecycleLock = NSLock()
  private let generationLock = NSLock()
  private var activeGeneration: UUID?
  private var activeRawProbeToken: UUID?
  private var activeCaptureOutput: AVCaptureOutput?
  private var activeCaptureProbeToken: UUID?
  private var active = false
  private let statsLock = NSLock()
  private var callbackCountStorage = 0
  private var successfulSampleProbeTokens: Set<UUID> = []
  private var convertFailCountStorage = 0

  private var captureSession: AVCaptureSession?
  private var audioEngine: AVAudioEngine?
  /** 启动失败的 engine 可能仍有异步 IOUnit 回调，延迟到 helper 回收再释放。 */
  private var quarantinedAudioEngines: [AVAudioEngine] = []
  private(set) var activeStrategy: MicCaptureStrategy?
  private(set) var activeDeviceKey: String?

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

  /** 按 raw AVAudioEngine → AVCaptureSession 的顺序挂载物理输入。 */
  @discardableResult
  func attach(
    preferredStrategy: MicCaptureStrategy? = nil,
    preferredDeviceKey: String? = nil
  ) -> UUID? {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }

    if isActive {
      return activeGenerationToken
    }

    let generation = UUID()
    generationLock.lock()
    activeGeneration = generation
    activeRawProbeToken = nil
    activeCaptureOutput = nil
    activeCaptureProbeToken = nil
    active = false
    generationLock.unlock()

    guard prepareMicCapture(
      generation: generation,
      preferredStrategy: preferredStrategy,
      preferredDeviceKey: preferredDeviceKey
    ) else {
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

  /** 停止物理输入，并排空已经投递到 sampleQueue 的 PCM callback。 */
  func detach() {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
    invalidateGeneration()
    stopPhysicalResources()
  }

  /** 只拆除调用方创建的那一代，避免 stale recovery 拆掉下一代 mic。 */
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

  /** stop 的 terminal 路径不拆 Core Audio，只让迟到 callback 失效。 */
  func invalidateGeneration() {
    _ = invalidateGeneration(ifMatching: nil)
  }

  @discardableResult
  private func invalidateGeneration(ifMatching expectedGeneration: UUID?) -> Bool {
    generationLock.lock()
    guard expectedGeneration == nil || activeGeneration == expectedGeneration else {
      generationLock.unlock()
      return false
    }
    activeGeneration = nil
    activeRawProbeToken = nil
    activeCaptureOutput = nil
    activeCaptureProbeToken = nil
    active = false
    activeStrategy = nil
    activeDeviceKey = nil
    generationLock.unlock()
    return true
  }

  var activeGenerationToken: UUID? {
    generationLock.lock()
    defer { generationLock.unlock() }
    return activeGeneration
  }

  private func prepareMicCapture(
    generation: UUID,
    preferredStrategy: MicCaptureStrategy?,
    preferredDeviceKey: String?
  ) -> Bool {
    let fingerprint = getDefaultInputDeviceFingerprint()
    if let fingerprint,
       let preferredStrategy,
       preferredDeviceKey == fingerprint.cacheKey,
       prepareMicCapture(strategy: preferredStrategy, generation: generation, rawWithRetry: false)
    {
      activeStrategy = preferredStrategy
      activeDeviceKey = fingerprint.cacheKey
      log("tap: cached raw mic strategy \(preferredStrategy.rawValue) ready")
      return true
    }

    let strategies: [MicCaptureStrategy] = [.rawAudioEngine, .captureSession]
    for strategy in strategies {
      guard isCurrent(generation) else { return false }
      let startedAt = Date()
      let ready = prepareMicCapture(
        strategy: strategy,
        generation: generation,
        rawWithRetry: true
      )
      let elapsedMS = Int(Date().timeIntervalSince(startedAt) * 1000)
      log("tap: mic strategy \(strategy.rawValue) ready=\(ready) elapsed=\(elapsedMS)ms")
      if ready {
        activeStrategy = strategy
        activeDeviceKey = fingerprint?.cacheKey
        return true
      }
    }
    return false
  }

  private func prepareMicCapture(
    strategy: MicCaptureStrategy,
    generation: UUID,
    rawWithRetry: Bool
  ) -> Bool {
    switch strategy {
    case .rawAudioEngine:
      if rawWithRetry {
        return prepareRawAudioEngineMicWithRetry(generation: generation)
      }
      return prepareRawAudioEngineMic(generation: generation) == .ready
    case .captureSession:
      return prepareCaptureSessionMic(generation: generation)
    }
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
          log(
            "tap: raw audio engine start failed after \(RAW_AUDIO_ENGINE_START_ATTEMPTS) "
              + "attempts, fallback to AVCaptureSession"
          )
          return false
        }
        log(
          "tap: raw audio engine retry \(attempt + 1)/\(RAW_AUDIO_ENGINE_START_ATTEMPTS) "
            + "after transient start failure"
        )
        Thread.sleep(forTimeInterval: RAW_AUDIO_ENGINE_RETRY_DELAY_SEC)
      }
    }
    return false
  }

  private func prepareRawAudioEngineMic(generation: UUID) -> EnginePrepareResult {
    guard isCurrent(generation) else { return .finalFailure }
    let engine = AVAudioEngine()
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      quarantineFailedAudioEngine(engine, input: input, tapInstalled: false)
      log("tap: raw audio engine mic format invalid, fallback to AVCaptureSession")
      return .finalFailure
    }
    guard format.channelCount <= 2 else {
      quarantineFailedAudioEngine(engine, input: input, tapInstalled: false)
      log(
        "tap: raw audio engine mic format \(format.channelCount)ch is not writer-compatible, "
          + "fallback to AVCaptureSession"
      )
      return .finalFailure
    }

    let sampleProbeToken = UUID()
    guard registerRawProbeToken(sampleProbeToken, generation: generation) else {
      quarantineFailedAudioEngine(engine, input: input, tapInstalled: false)
      return .finalFailure
    }
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
      clearRawProbeToken(sampleProbeToken, generation: generation)
      quarantineFailedAudioEngine(engine, input: input, tapInstalled: true)
      log("tap: raw audio engine start failed: \(describeError(error))")
      return .retryableFailure
    }

    guard isCurrent(generation) else {
      clearRawProbeToken(sampleProbeToken, generation: generation)
      quarantineFailedAudioEngine(engine, input: input, tapInstalled: true)
      return .finalFailure
    }
    guard waitForFirstMicSample(
      sampleProbeToken: sampleProbeToken,
      label: "raw audio engine",
      generation: generation
    ) else {
      clearRawProbeToken(sampleProbeToken, generation: generation)
      quarantineFailedAudioEngine(engine, input: input, tapInstalled: true)
      log(
        "tap: raw audio engine started but no samples in "
          + "\(Int(MIC_FIRST_SAMPLE_PROBE_TIMEOUT_SEC * 1000))ms, treating as transient failure"
      )
      return .retryableFailure
    }

    guard isCurrent(generation) else {
      clearRawProbeToken(sampleProbeToken, generation: generation)
      quarantineFailedAudioEngine(engine, input: input, tapInstalled: true)
      return .finalFailure
    }

    audioEngine = engine
    log(
      "tap: mic via raw AVAudioEngine (\(Int(format.sampleRate))Hz/\(format.channelCount)ch, "
        + "raw input)"
    )
    return .ready
  }

  /** 停止失败的 raw engine，但延迟析构到 helper 进程回收。 */
  private func quarantineFailedAudioEngine(
    _ engine: AVAudioEngine,
    input: AVAudioInputNode,
    tapInstalled: Bool
  ) {
    if tapInstalled {
      input.removeTap(onBus: 0)
    }
    engine.stop()
    quarantinedAudioEngines.append(engine)
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
        log(
          "tap: AVCaptureSession started but no samples in "
            + "\(Int(MIC_FIRST_SAMPLE_PROBE_TIMEOUT_SEC * 1000))ms, system audio only"
        )
        return false
      }

      guard isCurrent(generation) else {
        session.stopRunning()
        output.setSampleBufferDelegate(nil, queue: nil)
        clearCaptureOutput(for: generation)
        return false
      }
      captureSession = session
      log("tap: mic via raw AVCaptureSession")
      return true
    }
    catch {
      log("tap: mic capture setup failed: \(error.localizedDescription), system audio only")
      return false
    }
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
    guard isCurrentRawAttempt(generation, sampleProbeToken: sampleProbeToken),
          buffer.frameLength > 0 else { return }
    let captureHostTime = CMClockGetTime(CMClockGetHostTimeClock())
    incrementCallbackCount()
    guard let copied = copyPCMBuffer(buffer) else {
      incrementConvertFailCount()
      return
    }
    markSuccessfulSample(for: sampleProbeToken)
    sampleQueue.async { [weak self] in
      guard let self,
            self.isCurrentRawAttempt(generation, sampleProbeToken: sampleProbeToken) else { return }
      self.sampleHandler(copied, captureHostTime)
    }
  }

  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    guard let context = captureContext(for: output), sampleBuffer.isValid else { return }
    let captureHostTime = CMClockGetTime(CMClockGetHostTimeClock())
    incrementCallbackCount()
    guard let copied = PCMBufferNormalizer.copy(sampleBuffer) else {
      incrementConvertFailCount()
      return
    }
    markSuccessfulSample(for: context.sampleProbeToken)
    sampleQueue.async { [weak self] in
      guard let self, self.isCurrent(context.generation) else { return }
      self.sampleHandler(copied, captureHostTime)
    }
    _ = connection
  }

  private func copyPCMBuffer(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    guard let copied = AVAudioPCMBuffer(
      pcmFormat: buffer.format,
      frameCapacity: buffer.frameLength
    ) else { return nil }
    copied.frameLength = buffer.frameLength

    let sourceBuffers = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
    let targetBuffers = UnsafeMutableAudioBufferListPointer(copied.mutableAudioBufferList)
    guard sourceBuffers.count == targetBuffers.count else { return nil }
    for index in sourceBuffers.indices {
      guard let source = sourceBuffers[index].mData,
            let target = targetBuffers[index].mData
      else { return nil }
      let byteCount = min(
        Int(sourceBuffers[index].mDataByteSize),
        Int(targetBuffers[index].mDataByteSize)
      )
      memcpy(target, source, byteCount)
      targetBuffers[index].mDataByteSize = UInt32(byteCount)
    }
    return copied
  }

  private func isCurrent(_ generation: UUID) -> Bool {
    generationLock.lock()
    defer { generationLock.unlock() }
    return activeGeneration == generation
  }

  private func registerRawProbeToken(_ token: UUID, generation: UUID) -> Bool {
    generationLock.lock()
    defer { generationLock.unlock() }
    guard activeGeneration == generation else { return false }
    activeRawProbeToken = token
    return true
  }

  private func clearRawProbeToken(_ token: UUID, generation: UUID) {
    generationLock.lock()
    if activeGeneration == generation, activeRawProbeToken == token {
      activeRawProbeToken = nil
    }
    generationLock.unlock()
  }

  private func isCurrentRawAttempt(_ generation: UUID, sampleProbeToken: UUID) -> Bool {
    generationLock.lock()
    defer { generationLock.unlock() }
    return activeGeneration == generation && activeRawProbeToken == sampleProbeToken
  }

  private func registerCaptureOutput(
    _ output: AVCaptureOutput,
    generation: UUID,
    sampleProbeToken: UUID
  ) {
    generationLock.lock()
    if activeGeneration == generation {
      activeRawProbeToken = nil
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
}

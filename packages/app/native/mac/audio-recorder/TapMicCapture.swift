// 封装 tap 引擎的三级物理麦克风采集与 PCM 回调

import AVFoundation
import CoreMedia

/** 麦克风 PCM 已经经过的系统级处理，用于下游避免重复执行激进 AGC */
enum MicCaptureProcessingMode: String {
  case voiceProcessed = "voice-processed"
  case raw
}

/** 主进程可跨 helper 安全保留的麦克风采集路线提示 */
enum MicCaptureStrategy: String {
  case voiceProcessed
  case rawAudioEngine
  case captureSession
}

/**
 * VPIO(系统回声消除 / 降噪)这一轮的启用结果
 *
 * 实测症状:外放通话时对端声音会延迟约 120ms 漏进麦克风再录一遍,污染麦克风轨。
 * 曾经两台机器都开不起 VPIO——开启后 inputNode 从 1ch/48k 变成 7ch/44.1k,
 * 被当时 channelCount<=2 的守卫拒掉,整场退化成 raw,既没 AEC 也没系统降噪。
 *
 * 根因机制:VPIO 走的是另一条硬件通路,会改报 DiscreteInOrder 多声道布局
 * (layoutTag 0x930007),多出来的是回声计算用的 metadata 声道。把 7 个声道分别落盘
 * 逐字节比对,内容完全一致,ch0 就是处理后的人声——当时误把「布局语义未公开」
 * 当成了「不可用」。
 *
 * 方案边界:守卫已放宽为折叠到 ch0,这里只负责如实上报「这一轮 VPIO 到底成没成」,
 * 不参与降级决策。取值语义必须稳定,主进程按默认日志级别落盘做跨机型统计。
 *
 * 治本方向:自建 AEC 已实测证伪(线性可抵消上限只有 2~4 dB,VPIO 同条件 >20 dB),
 * 所以 VPIO 是唯一治本路径。若统计显示某类机型仍长期落在 unavailable /
 * engineStartFailed,再针对该原因单独处理,不要再整条放弃。
 */
enum MicVoiceProcessingOutcome: String {
  /** 本轮走了 VPIO,系统 AEC / 降噪生效 */
  case active
  /** 本轮没尝试 VPIO:调用方未要求 AEC */
  case notAttempted = "not-attempted"
  /**
   * 命中上一轮探测留下的非 VPIO 缓存路线,本轮没有重试 VPIO
   *
   * 与 notAttempted 分开是因为统计口径不同:这条不能计入「VPIO 失败」,
   * 真正的原因要看同一份日志里 recorder.micProbeCompleted 那条
   */
  case skippedCachedRoute = "skipped-cached-route"
  case unavailable
  case invalidFormat = "invalid-format"
  /** VPIO 报了多声道，但 PCM 不是非交错 float32，无法安全切出 ch0 */
  case unstableChannelLayout = "unstable-channel-layout"
  case engineStartFailed = "engine-start-failed"
  case noSamples = "no-samples"
}

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

  typealias SampleHandler = (AVAudioPCMBuffer, CMTime, MicCaptureProcessingMode) -> Void

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
  /**
   * `AVAudioEngine.start()` 抛错或首帧探测失败后，AVAudioIOUnit 仍可能有异步 property-listener 回调
   *
   * 立即析构失败的 raw / VPIO engine 会在 Apple 私有回调中触发 use-after-free。失败实例停止后保留到
   * helper 被录音 terminal 回收；正常成功的 engine 仍由 stopPhysicalResources 成对拆除
   */
  private var quarantinedAudioEngines: [AVAudioEngine] = []
  private(set) var activeStrategy: MicCaptureStrategy?
  private(set) var activeDeviceKey: String?
  /**
   * 最近一次 attach 尝试里 VPIO 的结果
   *
   * 刻意不在 detach 里清空:probeMic 先 detach 再上报,清空会把唯一的诊断信息抹掉。
   * 只在下一次 prepareMicCapture 入口重置
   */
  private(set) var voiceProcessingOutcome: MicVoiceProcessingOutcome = .notAttempted
  /** VPIO 报的声道数,>2 时会折成 ch0;跨机型统计布局是否还有别的形态 */
  private(set) var voiceProcessingChannelCount: Int?

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
  func attach(
    aec: Bool,
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
    activeCaptureOutput = nil
    activeCaptureProbeToken = nil
    active = false
    generationLock.unlock()

    guard prepareMicCapture(
      aec: aec,
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
    aec: Bool,
    generation: UUID,
    preferredStrategy: MicCaptureStrategy?,
    preferredDeviceKey: String?
  ) -> Bool {
    /** 每轮 attach 重新判定,避免上一轮的结论被当成本轮事实上报 */
    voiceProcessingOutcome = .notAttempted
    voiceProcessingChannelCount = nil

    let fingerprint = getDefaultInputDeviceFingerprint()
    if let fingerprint,
       let preferred = preferredStrategy,
       preferredDeviceKey == fingerprint.cacheKey,
       (aec || preferred != .voiceProcessed)
    {
      log("tap: trying cached mic strategy \(preferred.rawValue)")
      if prepareMicCapture(
        strategy: preferred,
        generation: generation,
        rawWithRetry: false
      ) {
        activeStrategy = preferred
        activeDeviceKey = fingerprint.cacheKey
        voiceProcessingOutcome = preferred == .voiceProcessed
          ? .active
          : .skippedCachedRoute
        log("tap: cached mic strategy \(preferred.rawValue) ready")
        return true
      }

      log("tap: cached mic strategy \(preferred.rawValue) failed, restoring full fallback")
    }

    guard isCurrent(generation) else { return false }
    let strategies: [MicCaptureStrategy] = aec
      ? [.voiceProcessed, .rawAudioEngine, .captureSession]
      : [.rawAudioEngine, .captureSession]

    for strategy in strategies {
      guard isCurrent(generation) else { return false }
      let startedAt = Date()
      let ready = prepareMicCapture(
        strategy: strategy,
        generation: generation,
        rawWithRetry: true
      )
      let elapsedMs = Int(Date().timeIntervalSince(startedAt) * 1000)
      log("tap: mic strategy \(strategy.rawValue) ready=\(ready) elapsed=\(elapsedMs)ms")
      if ready {
        if let fingerprint {
          activeStrategy = strategy
          activeDeviceKey = fingerprint.cacheKey
        }
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
    case .voiceProcessed:
      return prepareVoiceProcessedMic(generation: generation)
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
      voiceProcessingOutcome = .unavailable
      log("tap: voice processing unavailable: \(error.localizedDescription)")
      quarantineFailedAudioEngine(engine, input: input, tapInstalled: false, disableVoiceProcessing: true)
      return false
    }

    /**
     * 正在录系统音频：把 VPIO 对其它 App 的闪避压到最低，否则混入的系统音轨会被压低
     *
     * 实测(内置扬声器，外部进程放音，用我们自己的 tap 量同一条时间线):
     * VPIO 关 = 基准，duckingLevel .default = -29.1 dB，.min = -8.7 dB。
     * .min 已是能拿到的最好结果——闪避本身关不掉:iOS 的
     * kAUVoiceIOProperty_DuckNonVoiceAudio(2102) 在 macOS 上标了 API_UNAVAILABLE，
     * 实测强行写入也仍是 -8.2 dB，与 .min 无差别。
     *
     * 也就是说开 VPIO 必然要付 ~8.7 dB 的系统音轨代价，换回 >20 dB 的回声抑制
     */
    input.voiceProcessingOtherAudioDuckingConfiguration
      = AVAudioVoiceProcessingOtherAudioDuckingConfiguration(enableAdvancedDucking: false, duckingLevel: .min)

    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      voiceProcessingOutcome = .invalidFormat
      log("tap: voice processing mic format invalid, fallback to raw capture")
      quarantineFailedAudioEngine(engine, input: input, tapInstalled: false, disableVoiceProcessing: true)
      return false
    }
    /**
     * VPIO 启用后 inputNode 会改报多声道（本机 1ch/48k → 7ch/44.1k，layoutTag 0x930007 即
     * DiscreteInOrder）。实测把 7 个声道分别落盘逐字节比对，内容完全一致；Apple 开发者论坛对该
     * 现象的说明也是「多出来的是回声计算用的 metadata 声道，取 ch0、其余忽略」。
     *
     * 所以多声道不是放弃 VPIO 的理由，只需在回调里折成 ch0 单声道。仅当 PCM 不是
     * 非交错 float32（无法安全按声道切片）时才退回 raw
     */
    let foldsToFirstChannel = format.channelCount > 2
    if foldsToFirstChannel {
      voiceProcessingChannelCount = Int(format.channelCount)
      guard format.commonFormat == .pcmFormatFloat32, !format.isInterleaved else {
        voiceProcessingOutcome = .unstableChannelLayout
        log("tap: voice processing mic format \(format.channelCount)ch is not deinterleaved float32, fallback to raw capture")
        quarantineFailedAudioEngine(engine, input: input, tapInstalled: false, disableVoiceProcessing: true)
        return false
      }
      log("tap: voice processing mic reports \(format.channelCount)ch discrete layout, folding to channel 0")
    }

    guard isCurrent(generation) else {
      quarantineFailedAudioEngine(engine, input: input, tapInstalled: false, disableVoiceProcessing: true)
      return false
    }

    let sampleProbeToken = UUID()
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      self?.handleMicBuffer(
        buffer,
        generation: generation,
        sampleProbeToken: sampleProbeToken,
        processingMode: .voiceProcessed,
        foldToFirstChannel: foldsToFirstChannel
      )
    }

    engine.prepare()
    do {
      try engine.start()
    }
    catch {
      quarantineFailedAudioEngine(engine, input: input, tapInstalled: true, disableVoiceProcessing: true)
      voiceProcessingOutcome = .engineStartFailed
      log("tap: audio engine start failed: \(error.localizedDescription), fallback to raw capture")
      return false
    }

    guard isCurrent(generation) else {
      quarantineFailedAudioEngine(engine, input: input, tapInstalled: true, disableVoiceProcessing: true)
      return false
    }

    guard waitForFirstMicSample(
      sampleProbeToken: sampleProbeToken,
      label: "voice-processed audio engine",
      generation: generation
    ) else {
      quarantineFailedAudioEngine(engine, input: input, tapInstalled: true, disableVoiceProcessing: true)
      voiceProcessingOutcome = .noSamples
      log("tap: voice-processed audio engine started but no samples in \(Int(MIC_FIRST_SAMPLE_PROBE_TIMEOUT_SEC * 1000))ms, fallback to raw capture")
      return false
    }

    guard isCurrent(generation) else {
      quarantineFailedAudioEngine(engine, input: input, tapInstalled: true, disableVoiceProcessing: true)
      return false
    }

    audioEngine = engine
    voiceProcessingOutcome = .active
    log("tap: mic via voice-processed AVAudioEngine (\(Int(format.sampleRate))Hz/\(format.channelCount)ch, AGC=\(input.isVoiceProcessingAGCEnabled), bypass=\(input.isVoiceProcessingBypassed))")
    return true
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
      log("tap: raw audio engine mic format \(format.channelCount)ch is not writer-compatible, fallback to AVCaptureSession")
      return .finalFailure
    }

    let sampleProbeToken = UUID()
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      self?.handleMicBuffer(
        buffer,
        generation: generation,
        sampleProbeToken: sampleProbeToken,
        processingMode: .raw
      )
    }

    engine.prepare()
    do {
      try engine.start()
    }
    catch {
      quarantineFailedAudioEngine(engine, input: input, tapInstalled: true)
      log("tap: raw audio engine start failed: \(describeError(error))")
      return .retryableFailure
    }

    guard isCurrent(generation) else {
      quarantineFailedAudioEngine(engine, input: input, tapInstalled: true)
      return .finalFailure
    }

    guard waitForFirstMicSample(
      sampleProbeToken: sampleProbeToken,
      label: "raw audio engine",
      generation: generation
    ) else {
      quarantineFailedAudioEngine(engine, input: input, tapInstalled: true)
      log("tap: raw audio engine started but no samples in \(Int(MIC_FIRST_SAMPLE_PROBE_TIMEOUT_SEC * 1000))ms, treating as transient failure")
      return .retryableFailure
    }

    guard isCurrent(generation) else {
      quarantineFailedAudioEngine(engine, input: input, tapInstalled: true)
      return .finalFailure
    }

    audioEngine = engine
    log("tap: mic via raw AVAudioEngine (\(Int(format.sampleRate))Hz/\(format.channelCount)ch, no AEC)")
    return .ready
  }

  /**
   * 停止失败的 raw / VPIO engine，但延迟其析构到 helper 进程回收
   *
   * macOS 26 的 AVAudioIOUnit 可能在 start 抛 `!dev` 后继续异步访问 engine；这里只保留
   * 物理对象生命周期，不改变 raw → AVCaptureSession 的降级策略
   */
  private func quarantineFailedAudioEngine(
    _ engine: AVAudioEngine,
    input: AVAudioInputNode,
    tapInstalled: Bool,
    disableVoiceProcessing: Bool = false
  ) {
    if tapInstalled {
      input.removeTap(onBus: 0)
    }
    if disableVoiceProcessing {
      try? input.setVoiceProcessingEnabled(false)
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
    sampleProbeToken: UUID,
    processingMode: MicCaptureProcessingMode,
    foldToFirstChannel: Bool = false
  ) {
    guard isCurrent(generation), buffer.frameLength > 0 else { return }
    /** 先取 helper host clock，避免高负载下拷贝 PCM 的耗时污染样本时间轴 */
    let captureHostTime = CMClockGetTime(CMClockGetHostTimeClock())
    incrementCallbackCount()
    let extracted = foldToFirstChannel ? firstChannelBuffer(buffer) : copyPCMBuffer(buffer)
    guard let copied = extracted else {
      incrementConvertFailCount()
      return
    }
    markSuccessfulSample(for: sampleProbeToken)

    sampleQueue.async { [weak self] in
      guard let self, self.isCurrent(generation) else { return }
      self.sampleHandler(copied, captureHostTime, processingMode)
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
      self.sampleHandler(pcmBuffer, captureHostTime, .raw)
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

  /**
   * 取多声道 VPIO buffer 的 ch0 拷成单声道
   *
   * VPIO 的 DiscreteInOrder 布局里 ch0 是处理后的人声，其余是回声计算的 metadata。
   * 调用方须已确认 buffer 是非交错 float32
   */
  private func firstChannelBuffer(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    guard let source = buffer.floatChannelData?[0],
          let monoFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: buffer.format.sampleRate,
            channels: 1,
            interleaved: false
          ),
          let mono = AVAudioPCMBuffer(pcmFormat: monoFormat, frameCapacity: buffer.frameLength),
          let target = mono.floatChannelData?[0]
    else { return nil }

    mono.frameLength = buffer.frameLength
    memcpy(target, source, Int(buffer.frameLength) * MemoryLayout<Float>.size)
    return mono
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

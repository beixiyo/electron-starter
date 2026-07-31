import AVFoundation
import Cocoa
import CoreAudio
import CoreGraphics
import CoreMedia
import ScreenCaptureKit

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

/** sampleQueue 尾部哨兵与 timeout 竞争时只恢复 continuation 一次 */
private final class SampleQueueDrainResolution: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<Bool, Never>?

  init(_ continuation: CheckedContinuation<Bool, Never>) {
    self.continuation = continuation
  }

  func resolve(_ drained: Bool) {
    lock.lock()
    let continuation = continuation
    self.continuation = nil
    lock.unlock()
    continuation?.resume(returning: drained)
  }
}

// MARK: - Tap 手动录音引擎（Core Audio process tap + mic 双轨，macOS 14.2+）

@available(macOS 14.2, *)
class TapRecorder: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
  private enum MicEnginePrepareResult {
    case ready
    case retryableFailure
    case finalFailure
  }

  private var tapID = AudioObjectID(kAudioObjectUnknown)
  private var aggregateID = AudioObjectID(kAudioObjectUnknown)
  private var deviceProcID: AudioDeviceIOProcID?
  /** tap IOProc 与 mic 回调共用一条串行队列,保证 writer 启动会话与 append 无竞态 */
  private let sampleQueue = DispatchQueue(label: "tap-recorder", qos: .userInitiated)
  /** 开录完成后，audioEngine / captureSession / tap 管线变更的唯一物理生命周期执行队列 */
  private let micLifecycleQueue = DispatchQueue(label: "tap-recorder-mic-lifecycle", qos: .userInitiated)
  private let captureUpdateLock = NSLock()
  private var captureUpdateScheduled = false
  private var pendingCaptureUpdate: (
    generation: UUID,
    tapEnabled: Bool,
    micEnabled: Bool,
    pids: [pid_t],
    excludePids: [pid_t]
  )?

  private var writer: AVAssetWriter?
  private var checkpointWriter: AudioCheckpointWriter?
  private var systemInput: AVAssetWriterInput?
  private var micInput: AVAssetWriterInput?
  private var micSidecarURL: URL?
  private var micAudioFile: AVAudioFile?
  /** mic sidecar 写盘失败单独保留，停止收尾时归一化为 storage_insufficient */
  private var micSidecarWriteError: Error?
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
  /**
   * 两轨各自的最近出样时刻,拆分是为了让「单轨死亡」可见:
   * 从前 mic 与系统音共用一个时间戳,mic 掉线后系统音仍在刷新它 → 断流看门狗恒不触发,
   * mic 死亡被完全掩盖(见 #1865:蓝牙掉线后 mic 仅录到前 3.4 分钟却全程无告警)
   */
  private var sysLastSampleAt: Date?
  private var micLastSampleAt: Date?

  /**
   * mic「用户意图」与「引擎实挂」分离:
   * - micRequested:用户是否要录麦克风(start withMic / update micEnabled 决定)
   * - micActive:采集引擎当前是否真的挂着(见上方定义)
   * 重挂失败后 micActive=false 但 micRequested 仍 true,据此持续重试,不会因一次失败永久失去麦克风
   */
  private var micRequested = false
  /**
   * 系统默认输入设备变更监听(CoreAudio HAL 层,独立于 mic 引擎生命周期)
   * 关键:engine 销毁后其自身通知也随之消失,只有 HAL 监听在整场录音存活 → 设备复联时仍能拉起重挂,
   * 这是「重挂失败后不永久失去麦克风」的兜底(engine 绑定的监听做不到)
   */
  private var defaultInputListenerBlock: AudioObjectPropertyListenerBlock?
  private let deviceListenerQueue = DispatchQueue(label: "tap-recorder-device-listener", qos: .utility)
  /** mic 自愈连续失败计数:达 MIC_RECOVERY_MAX_ATTEMPTS 停看门狗周期重试并发一次降级诊断;设备变更或重挂成功清零 */
  private var micRecoveryAttempts = 0
  private var micDegradedEmitted = false
  /** mic recovery 的唯一状态所有者：调度、换代、取消、在飞标记与 callback gate 全在同一锁内 */
  private let micRecoveryLock = NSLock()
  private var micRecoveryToken: UUID?
  private var micRecoveryWorkItem: DispatchWorkItem?
  private var micRecoveryInFlight = false
  private var micRecoveryRerunReason: String?
  private var recordingGeneration = UUID()
  private var acceptMicSamples = false
  private var acceptTapSamples = false
  private var micRecoveryRequested = false
  /** 每次 attach 都换代；旧 engine 的迟到 callback 即使仍在执行也不能写入新一代录音 */
  private var activeMicGeneration: UUID?
  private var activeCaptureOutput: AVCaptureOutput?

  private var tapFormat: AudioStreamBasicDescription?
  private var tapFormatDescription: CMAudioFormatDescription?
  /** VPIO mic 格式引擎生命周期内恒定,建一次缓存复用,避免每 buffer 重建 CMAudioFormatDescription（音频渲染线程反模式） */
  private var micFormatDescription: CMAudioFormatDescription?
  /** mic sidecar 转换器缓存(同 micFormatDescription 模式):AVAudioConverter 含重采样滤波器缓冲,每 buffer 新建是音频回调路径反模式;source format 变化才重建 */
  private var micSidecarConverter: AVAudioConverter?
  private var micSidecarConverterSourceFormat: AVAudioFormat?

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
  private var micLastRawPTS: CMTime?
  private var micLastBufferDuration: CMTime?
  private var micNextPTS: CMTime?
  private var micSyntheticPTSActive = false
  private var micPtsFrozenCount = 0
  private var micPtsRegressCount = 0
  private var micPtsCompressedCount = 0
  private var micPtsSyntheticCount = 0
  private var micSampleFormatLogged = false
  private var micSidecarFormatConversionLogged = false

  @discardableResult
  func start(outputPath: String, pids: [pid_t], excludePids: [pid_t], withMic: Bool, tapEnabled: Bool, micAec: Bool) async -> Bool {
    guard writer == nil else {
      emitError("already_recording")
      return false
    }

    beginRecordingGeneration(micRequested: withMic)
    self.outputPath = outputPath
    self.micAecPref = micAec
    self.micRequested = withMic
    let outputURL = URL(fileURLWithPath: outputPath)
    micSidecarURL = outputURL.deletingLastPathComponent()
      .appendingPathComponent("\(outputURL.deletingPathExtension().lastPathComponent).mic.caf")
    if let micSidecarURL {
      try? FileManager.default.removeItem(at: micSidecarURL)
    }

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
      /** HAL 设备监听登记一次即覆盖整场(含日后 update 热挂 mic),独立于 mic 引擎存活 */
      registerDefaultInputDeviceListener()
      log("tap start: mic=\(micReady) tap=\(tapEnabled) devices: \(describeDefaultAudioDevices())")
      emitStatus("recording", path: outputPath)
      return true
    }
    catch {
      if isStorageInsufficientError(error) {
        emitError("storage_insufficient", detail: describeError(error))
      }
      else {
        emitError((error as? TapRecorderError)?.message ?? error.localizedDescription)
      }
      cleanup()
      return false
    }
  }

  /**
   * 录音中在线变更音源（UI 音源多选条勾选变化时调用）：
   * - mic：micEnabled 切换 mic 采集引擎挂/卸（mic 轨恒预建，只切进样）
   * - tap：tapEnabled=false 拆 tap 管线；true 且未挂载则新建；true 且已挂载则重建（变更进程集合）
   *
   * writer 两轨恒不动，PTS 用 host time 天然连续，切换只产生几十毫秒的音源间隙
   * 新描述构造失败（如目标进程已退出）时旧管线原样保留，仅记日志不打断录音
   */
  func update(tapEnabled: Bool, micEnabled: Bool, pids: [pid_t], excludePids: [pid_t]) {
    guard writer != nil else {
      log("update ignored: not recording")
      return
    }

    /**
     * command chain 只更新 desired state 与 callback gate，绝不直接调用 Core Audio
     * 最新全量 update 由 lifecycle queue 串行应用；旧 update 在 stop 换代后自动失效
     */
    micRequested = micEnabled
    setMicRecoveryRequested(micEnabled)
    if micEnabled {
      enableMicSampleGate()
    }
    else {
      disableMicSampleGate()
      cancelScheduledMicRecovery()
    }
    setTapSampleGate(tapEnabled)

    let generation = currentRecordingGeneration()
    captureUpdateLock.lock()
    pendingCaptureUpdate = (
      generation,
      tapEnabled,
      micEnabled,
      pids,
      excludePids
    )
    let shouldSchedule = !captureUpdateScheduled
    captureUpdateScheduled = true
    captureUpdateLock.unlock()

    if shouldSchedule {
      micLifecycleQueue.async { [weak self] in
        self?.applyPendingCaptureUpdates()
      }
    }
  }

  /** 仅在 micLifecycleQueue 调用，独占全部物理 Core Audio 生命周期 */
  private func applyCaptureUpdate(
    tapEnabled: Bool,
    micEnabled: Bool,
    pids: [pid_t],
    excludePids: [pid_t]
  ) {
    if micEnabled, !isMicActive() {
      resetMicRecoveryBackoff()
      if attachMic(aec: micAecPref) {
        log("mic attached")
      }
      else {
        log("mic attach failed, no mic capture")
      }
    }
    else if !micEnabled, isMicActive() {
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
      /** 罕见:旧管线已拆、新管线失败——mic 轨继续录,系统音轨静默缺失,只能日志留痕
       * 分阶段失败(tap 建成后 aggregate/IOProc 抛错)会留下半建的内核对象句柄,
       * 必须拆干净(teardown 对 kAudioObjectUnknown 幂等),否则下次重试覆盖 ID 永久泄漏 */
      teardownTapPipeline()
      log("tap update failed after teardown: \((error as? TapRecorderError)?.message ?? error.localizedDescription)")
    }
  }

  private func applyPendingCaptureUpdates() {
    while true {
      captureUpdateLock.lock()
      guard let update = pendingCaptureUpdate else {
        captureUpdateScheduled = false
        captureUpdateLock.unlock()
        return
      }
      pendingCaptureUpdate = nil
      captureUpdateLock.unlock()

      guard isRecordingGenerationActive(update.generation) else {
        log("tap: stale capture update discarded")
        continue
      }
      applyCaptureUpdate(
        tapEnabled: update.tapEnabled,
        micEnabled: update.micEnabled,
        pids: update.pids,
        excludePids: update.excludePids
      )
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
    cancelScheduledMicRecovery()
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
      let pausedHostDuration = CMTimeSubtract(CMClockGetTime(CMClockGetHostTimeClock()), pauseStart)
      pauseOffset = CMTimeAdd(pauseOffset, pausedHostDuration)
      /** mic 时间轴状态由采样队列读写，平移也放到同队列执行，避免跨线程撕裂读 CMTime */
      sampleQueue.sync { shiftMicTimeline(by: pausedHostDuration) }
      pauseStartHostTime = nil
    }
    paused = false
    if micRequested {
      enableMicSampleGate()
      requestMicRecovery(reason: "recording-resumed")
    }
    /** 恢复后重置两轨基准:暂停时段无样本,陈旧时间戳会让下一 tick 误判掉线 */
    let resumedAt = Date()
    sysLastSampleAt = resumedAt
    micLastSampleAt = resumedAt
    if !sessionStarted {
      startFirstSampleWatchdog()
    }
    startSampleGapWatchdog()
    emitStatus("recording", path: outputPath)
  }

  func stop(handoffId: Int? = nil) async {
    guard writer != nil else {
      emitTerminalError("not_recording", path: outputPath, handoffId: handoffId)
      return
    }
    guard !isFinalizingRecording else { return }
    isFinalizingRecording = true
    defer { isFinalizingRecording = false }
    /** stop/finalizing 期间不再允许首帧或 gap watchdog 发出录音中 error */
    firstSampleWatchdogToken = UUID()
    sampleGapWatchdogToken = UUID()

    if paused, let pa = pausedAt {
      totalPausedDuration += Date().timeIntervalSince(pa)
    }

    /** 必须在拆管线前快照:stopCapturePipeline → detachMic 会把 micActive 清为 false,
     * 事后再读恒为 false,零样本收尾会把 mic 采集故障误报成「无音频内容」 */
    let hadMicAtStop = micRequested

    cancelMicRecoveryForStop()
    clearPendingCaptureUpdate()
    /**
     * stop 永远不调用 stopRunning/removeTap/engine.stop/AudioDeviceStop
     * HAL settle、pending recovery 与任何已挂起 lifecycle 操作都统一视为不安全；
     * callback gate 已原子关闭，文件交接完成后由父进程回收整个 helper
     */
    /**
     * 不可用 sync：recovery 若正卡在 sampleQueue 内，stop 会排在它后面永久等待
     * 超时后 writer 仍可能被队列访问，故绝不能 markAsFinished / cleanup；保留 checkpoint
     * 与 mic sidecar，通知父进程强杀 helper，交给启动恢复扫描重建可用产物
     */
    guard await drainSampleQueue(timeout: SAMPLE_QUEUE_DRAIN_TIMEOUT_SEC) else {
      let detail = "sample queue did not drain within \(SAMPLE_QUEUE_DRAIN_TIMEOUT_SEC)s; preserving recovery assets"
      log("tap: finalize aborted — \(detail)")
      if let handoffId {
        emitRecycleDirective(handoffId: handoffId, detail: detail)
      }
      emitTerminalError("finalize_queue_timeout", path: outputPath, detail: detail, handoffId: handoffId)
      return
    }

    systemInput?.markAsFinished()
    micInput?.markAsFinished()

    if let writer, writer.status == .writing {
      await writer.finishWriting()
    }
    let checkpoints = checkpointWriter
    checkpoints?.finish()
    let writerStatus = writer?.status
    let writerError = describeError(writer?.error)
    let hasStorageWriteError = isStorageInsufficientError(writer?.error)
      || isStorageInsufficientError(micSidecarWriteError)
    let storageWriteError = isStorageInsufficientError(writer?.error)
      ? writerError
      : describeError(micSidecarWriteError)
    let micSidecarPath = micSidecarURL?.path
    micAudioFile = nil
    var micSidecarDuration = CMTime.zero
    if let micSidecarPath {
      micSidecarDuration = await readableAudioDuration(URL(fileURLWithPath: micSidecarPath))
    }
    let hasMicSidecarSamples = micSidecarDuration > .zero
    let didWriteSamples = (sysAppendCount + micAppendCount) > 0
    if let writer, writer.status == .failed {
      log("tap: writer finish failed: \(writerError)")
    }
    let stats = "tapCb=\(tapCallbackCount) sysOK=\(sysAppendCount) sysDrop=\(sysDropCount) micCb=\(micCallbackCount) micConvFail=\(micConvertFailCount) micOK=\(micAppendCount) micDrop=\(micDropCount)"
    log("tap stats: \(stats) devices: \(describeDefaultAudioDevices())")

    let elapsed = startTime.map { Date().timeIntervalSince($0) } ?? 0
    let duration = max(0, elapsed - totalPausedDuration)
    let savedPath = outputPath

    cleanup(skipMicTeardown: true)

    if hasStorageWriteError {
      log("tap: recording storage insufficient: \(storageWriteError)")
      emitRecycleRequired(handoffId: handoffId)
      emitTerminalError("storage_insufficient", path: savedPath, detail: storageWriteError, handoffId: handoffId)
      return
    }

    if !didWriteSamples {
      log("tap: writer finish failed: no audio samples")
      checkpoints?.deleteAll()
      try? FileManager.default.removeItem(atPath: savedPath)
      let error = hadMicAtStop ? "no_audio_samples" : "no_audio_content"
      emitRecycleRequired(handoffId: handoffId)
      emitTerminalError(error, path: savedPath, detail: stats, handoffId: handoffId)
      return
    }

    if writerStatus != .completed && !hasMicSidecarSamples {
      log("tap: writer finish failed: status=\(writerStatus?.rawValue ?? -1) error=\(writerError)")
      try? FileManager.default.removeItem(atPath: savedPath)
      emitRecycleRequired(handoffId: handoffId)
      emitTerminalError("writer_failed", path: savedPath, detail: writerError, handoffId: handoffId)
      return
    }
    if writerStatus != .completed {
      log("tap: writer finish failed but mic sidecar exists (\(formatCMTimeSeconds(micSidecarDuration))s), trying sidecar mix: status=\(writerStatus?.rawValue ?? -1) error=\(writerError)")
    }

    /**
     * 两轨恒预建,mixTracks 内部过滤零时长轨后按非空轨数产出单轨（纯系统 / 纯 mic / 混音统一收口）——
     * 音源可录音中任意增减，收尾无需再判断「有没有 mic」
    */
    emitStatus("mixing", path: savedPath)
    let extraInputs = hasMicSidecarSamples
      ? micSidecarPath.map { [$0] } ?? []
      : []
    let mixed = await mixTracks(inputPath: savedPath, extraInputPaths: extraInputs)
    if !mixed {
      log("mixTracks failed, keeping original file")
    }
    if mixed, let micSidecarPath {
      consumeMicSidecarFile(URL(fileURLWithPath: micSidecarPath), context: "tap stop")
    }

    emitRecycleRequired(handoffId: handoffId)
    emitStatus("stopped", path: savedPath, duration: duration, handoffId: handoffId)
  }

  private func startFirstSampleWatchdog() {
    firstSampleErrorEmitted = false
    let token = UUID()
    let generation = currentRecordingGeneration()
    let path = outputPath
    firstSampleWatchdogToken = token

    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + FIRST_AUDIO_SAMPLE_TIMEOUT) { [weak self] in
      guard let self else { return }

      self.sampleQueue.async { [weak self] in
        guard let self else { return }
        guard self.firstSampleWatchdogToken == token,
              self.writer != nil,
              self.isMicActive(),
              !self.paused,
              (self.sysAppendCount + self.micAppendCount) == 0,
              !self.firstSampleErrorEmitted
        else { return }

        self.firstSampleErrorEmitted = true
        log("tap: first audio sample timeout")
        self.emitWatchdogError(
          "no_audio_samples",
          generation: generation,
          path: path,
          detail: "no first sample within \(Int(FIRST_AUDIO_SAMPLE_TIMEOUT))s, devices: \(describeDefaultAudioDevices())"
        )
      }
    }
  }

  private func startSampleGapWatchdog() {
    sampleGapErrorEmitted = false
    let token = UUID()
    sampleGapWatchdogToken = token
    scheduleSampleGapWatchdog(
      token,
      generation: currentRecordingGeneration(),
      path: outputPath
    )
  }

  private func scheduleSampleGapWatchdog(_ token: UUID, generation: UUID, path: String) {
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + AUDIO_SAMPLE_GAP_WATCHDOG_INTERVAL) { [weak self] in
      guard let self else { return }

      self.sampleQueue.async { [weak self] in
        guard let self else { return }
        guard self.sampleGapWatchdogToken == token,
              self.writer != nil
        else { return }

        if !self.paused {
          let now = Date()

          /**
           * mic 单轨自愈(仅当用户仍要录麦克风时):
           * - micActive 但持续静默:引擎僵尸化(蓝牙掉线典型),系统音轨仍刷新 sysLastSampleAt、整体不超时,
           *   只能按 mic 独立时间戳发现 → 重挂(detach + re-attach 到当前默认输入设备)
           * - !micActive:上一次重挂失败已丢麦,未达重试上限则周期重挂;达上限即停手,交由 HAL 设备变更监听在复联时拉起
           */
          if self.micRequested {
            if self.isMicActive() {
              if let micAt = self.micLastSampleAt,
                 now.timeIntervalSince(micAt) >= MIC_SAMPLE_GAP_TIMEOUT {
                let micGap = Int(now.timeIntervalSince(micAt))
                log("tap: mic sample gap \(micGap)s (micCb=\(self.micCallbackCount) micOK=\(self.micAppendCount)), requesting mic recovery, devices: \(describeDefaultAudioDevices())")
                self.requestMicRecovery(reason: "mic-gap \(micGap)s")
              }
            }
            else if self.micRecoveryCanRetry() {
              self.requestMicRecovery(reason: "mic-absent")
            }
          }

          /** 整体断流:所有在挂音源都超时无样本才判致命(任一源仍出样即视为录音存活,不误报) */
          if let latestActive = self.mostRecentActiveSampleAt(),
             now.timeIntervalSince(latestActive) >= AUDIO_SAMPLE_GAP_TIMEOUT,
             !self.sampleGapErrorEmitted {
            self.sampleGapErrorEmitted = true
            let gap = Int(now.timeIntervalSince(latestActive))
            log("tap: audio sample gap timeout (gap=\(gap)s)")
            self.emitWatchdogError(
              "audio_sample_timeout",
              generation: generation,
              path: path,
              detail: "no samples for \(gap)s, sysOK=\(self.sysAppendCount) micOK=\(self.micAppendCount), devices: \(describeDefaultAudioDevices())"
            )
            return
          }
        }

        self.scheduleSampleGapWatchdog(token, generation: generation, path: path)
      }
    }
  }

  /**
   * generation 校验与 stdout emission 共用 micRecoveryLock
   * stop 若先换代则事件不再发；事件若先发则携带旧 path，消费层会拒绝其作用于新 session
   */
  private func emitWatchdogError(
    _ error: String,
    generation: UUID,
    path: String,
    detail: String
  ) {
    micRecoveryLock.lock()
    guard recordingGeneration == generation else {
      micRecoveryLock.unlock()
      return
    }
    emitRecordingError(error, path: path, detail: detail)
    micRecoveryLock.unlock()
  }

  /** 在挂音源中最近一次出样时刻(取 tap / mic 两轨较新者);无任何在挂源返回 nil */
  private func mostRecentActiveSampleAt() -> Date? {
    var latest: Date?
    if tapActive, let sys = sysLastSampleAt {
      latest = latest.map { max($0, sys) } ?? sys
    }
    if isMicActive(), let mic = micLastSampleAt {
      latest = latest.map { max($0, mic) } ?? mic
    }
    return latest
  }

  // ── mic 单轨自愈(设备掉线/切换后重挂) ──

  /**
   * HAL 与 watchdog 统一进入 trailing debounce：
   * - 每个新请求替换 pending work item，真正执行时间始终是「最后一次请求 + settle window」
   * - recovery 已在飞时只登记一次 rerun，完成后重新经过同一静默窗口
   * - 物理拆建在专属 lifecycle queue 执行，绝不占住 stdin 的全局 command chain
   */
  private func requestMicRecovery(reason: String, expectedGeneration: UUID? = nil) {
    micRecoveryLock.lock()
    guard acceptMicSamples,
          micRecoveryRequested,
          expectedGeneration.map({ $0 == recordingGeneration }) ?? true
    else {
      micRecoveryLock.unlock()
      return
    }

    if micRecoveryInFlight {
      micRecoveryRerunReason = reason
      micRecoveryLock.unlock()
      log("tap: mic recovery rerun requested (\(reason))")
      return
    }

    micRecoveryWorkItem?.cancel()
    let token = UUID()
    let generation = recordingGeneration
    let workItem = DispatchWorkItem { [weak self] in
      self?.launchMicRecovery(reason: reason, token: token, generation: generation)
    }
    micRecoveryToken = token
    micRecoveryWorkItem = workItem
    micRecoveryLock.unlock()

    log("tap: mic recovery scheduled (\(reason), settle=\(MIC_DEVICE_CHANGE_SETTLE_DELAY_SEC)s)")
    deviceListenerQueue.asyncAfter(
      deadline: .now() + MIC_DEVICE_CHANGE_SETTLE_DELAY_SEC,
      execute: workItem
    )
  }

  private func launchMicRecovery(reason: String, token: UUID, generation: UUID) {
    micRecoveryLock.lock()
    guard micRecoveryToken == token,
          recordingGeneration == generation,
          acceptMicSamples,
          !(micRecoveryWorkItem?.isCancelled ?? true)
    else {
      micRecoveryLock.unlock()
      return
    }

    micRecoveryWorkItem = nil
    micRecoveryInFlight = true
    if reason == "default-input-changed" {
      micRecoveryAttempts = 0
      micDegradedEmitted = false
    }
    micRecoveryLock.unlock()

    micLifecycleQueue.async { [weak self] in
      self?.performMicRecovery(reason: reason, token: token, generation: generation)
    }
  }

  private func isMicRecoveryValid(token: UUID, generation: UUID) -> Bool {
    micRecoveryLock.lock()
    defer { micRecoveryLock.unlock() }
    return micRecoveryToken == token
      && recordingGeneration == generation
      && acceptMicSamples
      && micRecoveryRequested
  }

  private func finishMicRecovery(token: UUID, generation: UUID) {
    var rerunReason: String?

    micRecoveryLock.lock()
    if micRecoveryToken == token {
      micRecoveryToken = nil
    }
    micRecoveryInFlight = false
    if recordingGeneration == generation, acceptMicSamples {
      rerunReason = micRecoveryRerunReason
    }
    micRecoveryRerunReason = nil
    micRecoveryLock.unlock()

    if let rerunReason {
      requestMicRecovery(reason: rerunReason)
    }
  }

  /** start 与 recovery claim 共用同一原子边界，旧 callback 不可能读取到新一代 generation */
  private func beginRecordingGeneration(micRequested: Bool) {
    micRecoveryLock.lock()
    micRecoveryWorkItem?.cancel()
    micRecoveryWorkItem = nil
    micRecoveryToken = nil
    micRecoveryRerunReason = nil
    recordingGeneration = UUID()
    acceptMicSamples = true
    acceptTapSamples = true
    micRecoveryRequested = micRequested
    activeMicGeneration = nil
    activeCaptureOutput = nil
    micRecoveryLock.unlock()
  }

  private func currentRecordingGeneration() -> UUID {
    micRecoveryLock.lock()
    defer { micRecoveryLock.unlock() }
    return recordingGeneration
  }

  private func cancelScheduledMicRecovery() {
    micRecoveryLock.lock()
    micRecoveryWorkItem?.cancel()
    micRecoveryWorkItem = nil
    micRecoveryToken = nil
    micRecoveryRerunReason = nil
    if micRecoveryInFlight {
      acceptMicSamples = false
    }
    micRecoveryLock.unlock()
  }

  /**
   * stop 只取消逻辑采样，不等待不可取消的 Core Audio 拆建
   * 物理资源一律不在 stop 销毁，terminal 后由父进程回收 helper
   */
  private func cancelMicRecoveryForStop() {
    micRecoveryLock.lock()
    micRecoveryWorkItem?.cancel()
    micRecoveryWorkItem = nil
    micRecoveryToken = nil
    micRecoveryRerunReason = nil
    recordingGeneration = UUID()
    acceptMicSamples = false
    acceptTapSamples = false
    micRecoveryRequested = false
    activeMicGeneration = nil
    activeCaptureOutput = nil
    micRecoveryLock.unlock()
  }

  private func shouldAcceptMicSamples(generation: UUID) -> Bool {
    micRecoveryLock.lock()
    defer { micRecoveryLock.unlock() }
    return acceptMicSamples && activeMicGeneration == generation
  }

  private func shouldAcceptTapSamples() -> Bool {
    micRecoveryLock.lock()
    defer { micRecoveryLock.unlock() }
    return acceptTapSamples
  }

  private func enableMicSampleGate() {
    micRecoveryLock.lock()
    acceptMicSamples = true
    micRecoveryLock.unlock()
  }

  private func disableMicSampleGate() {
    micRecoveryLock.lock()
    acceptMicSamples = false
    micRecoveryLock.unlock()
  }

  private func setTapSampleGate(_ enabled: Bool) {
    micRecoveryLock.lock()
    acceptTapSamples = enabled
    micRecoveryLock.unlock()
  }

  private func isRecordingGenerationActive(_ generation: UUID) -> Bool {
    micRecoveryLock.lock()
    defer { micRecoveryLock.unlock() }
    return recordingGeneration == generation && (acceptMicSamples || acceptTapSamples)
  }

  private func setMicRecoveryRequested(_ requested: Bool) {
    micRecoveryLock.lock()
    micRecoveryRequested = requested
    micRecoveryLock.unlock()
  }

  private func isMicActive() -> Bool {
    micRecoveryLock.lock()
    defer { micRecoveryLock.unlock() }
    return micActive
  }

  private func setMicActive(_ active: Bool) {
    micRecoveryLock.lock()
    micActive = active
    micRecoveryLock.unlock()
  }

  private func beginMicGeneration() -> UUID {
    micRecoveryLock.lock()
    defer { micRecoveryLock.unlock() }
    let generation = UUID()
    activeMicGeneration = generation
    activeCaptureOutput = nil
    return generation
  }

  private func registerCaptureOutput(_ output: AVCaptureOutput, generation: UUID) {
    micRecoveryLock.lock()
    if activeMicGeneration == generation {
      activeCaptureOutput = output
    }
    micRecoveryLock.unlock()
  }

  private func captureGeneration(for output: AVCaptureOutput) -> UUID? {
    micRecoveryLock.lock()
    defer { micRecoveryLock.unlock() }
    guard activeCaptureOutput === output else { return nil }
    return activeMicGeneration
  }

  private func invalidateMicGeneration() {
    micRecoveryLock.lock()
    activeMicGeneration = nil
    activeCaptureOutput = nil
    micRecoveryLock.unlock()
  }

  /** 重挂成功 / 设备变更时清零退避,让耗尽重试次数的录音也能重新拉起 mic(锁内,可从任意队列安全调用) */
  private func resetMicRecoveryBackoff() {
    micRecoveryLock.lock()
    defer { micRecoveryLock.unlock() }
    micRecoveryAttempts = 0
    micDegradedEmitted = false
  }

  /** 看门狗用:是否还能再自动重挂(未达上限)。锁内读,避免与命令链上的写撕裂 */
  private func micRecoveryCanRetry() -> Bool {
    micRecoveryLock.lock()
    defer { micRecoveryLock.unlock() }
    return micRecoveryAttempts < MIC_RECOVERY_MAX_ATTEMPTS
  }

  /** 记一次重挂失败,返回当前累计次数与「是否应发降级诊断(首次跨过上限)」。锁内自增+置位,诊断在锁外发 */
  private func recordMicRecoveryFailure() -> (attempts: Int, shouldEmitDegraded: Bool) {
    micRecoveryLock.lock()
    defer { micRecoveryLock.unlock() }
    micRecoveryAttempts += 1
    let shouldEmit = micRecoveryAttempts >= MIC_RECOVERY_MAX_ATTEMPTS && !micDegradedEmitted
    if shouldEmit {
      micDegradedEmitted = true
    }
    return (micRecoveryAttempts, shouldEmit)
  }

  private func performMicRecovery(reason: String, token: UUID, generation: UUID) {
    defer { finishMicRecovery(token: token, generation: generation) }

    guard isMicRecoveryValid(token: token, generation: generation) else {
      log("tap: mic recovery cancelled before detach (\(reason))")
      return
    }

    let dropoutSec = micLastSampleAt.map { Int(Date().timeIntervalSince($0)) }
    /** 落设备拓扑快照:与开录快照一 diff 即可归因(蓝牙掉线切内置 / 切设备 / 采样率变更) */
    log("tap: mic recovery start (\(reason)), devices: \(describeDefaultAudioDevices())")

    /** 僵尸引擎先拆再建;上一次已丢麦(micActive=false)则直接重挂 */
    if isMicActive() {
      log("tap: mic recovery detach begin")
      detachMic()
      log("tap: mic recovery detach end")
    }

    guard isMicRecoveryValid(token: token, generation: generation) else {
      log("tap: mic recovery cancelled after detach (\(reason))")
      return
    }

    log("tap: mic recovery attach begin")
    let recovered = attachMic(aec: micAecPref)
    guard isMicRecoveryValid(token: token, generation: generation) else {
      log("tap: mic recovery result discarded (\(reason))")
      return
    }
    if recovered {
      /** attachMic 成功路径已清零 micRecoveryAttempts / micDegradedEmitted */
      log("tap: mic recovery succeeded (micCb=\(micCallbackCount)), devices: \(describeDefaultAudioDevices())")
      return
    }

    let (attempts, shouldEmitDegraded) = recordMicRecoveryFailure()
    log("tap: mic recovery failed (attempt \(attempts)/\(MIC_RECOVERY_MAX_ATTEMPTS), micCb=\(micCallbackCount)), devices: \(describeDefaultAudioDevices())")

    /**
     * 连续失败达上限:停看门狗周期重试(仍留 HAL 设备变更监听待复联拉起),并发一次非致命降级诊断
     * 否则最终仍可能正常出卡 / 转写成功 / 清本地文件,产品层表现为「录音成功但后半段无人声」的静默数据损失
     */
    if shouldEmitDegraded {
      let detail = "mic capture lost, recovery failed after \(attempts) attempts, dropout=\(dropoutSec.map { "\($0)s" } ?? "?"), reason=\(reason), devices: \(describeDefaultAudioDevices())"
      log("tap: mic capture degraded — \(detail)")
      emitDiagnostic("mic_degraded", detail: detail)
    }
  }

  private func clearPendingCaptureUpdate() {
    captureUpdateLock.lock()
    pendingCaptureUpdate = nil
    captureUpdateLock.unlock()
  }

  private func emitRecycleRequired(handoffId: Int?) {
    guard let handoffId else { return }
    emitRecycleDirective(
      handoffId: handoffId,
      detail: "tap recorder physical lifecycle is recycled after terminal handoff"
    )
  }

  // ── 系统默认输入设备变更监听(HAL 层,独立于 mic 引擎生命周期) ──

  private func handleDefaultInputDeviceChange(generation: UUID) {
    log("tap: default input device changed, devices: \(describeDefaultAudioDevices())")
    requestMicRecovery(reason: "default-input-changed", expectedGeneration: generation)
  }

  private func registerDefaultInputDeviceListener() {
    guard defaultInputListenerBlock == nil else { return }
    let generation = currentRecordingGeneration()
    var address = AudioObjectPropertyAddress(
      mSelector: kAudioHardwarePropertyDefaultInputDevice,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
      self?.handleDefaultInputDeviceChange(generation: generation)
    }
    let status = AudioObjectAddPropertyListenerBlock(
      AudioObjectID(kAudioObjectSystemObject), &address, deviceListenerQueue, block
    )
    if status == noErr {
      defaultInputListenerBlock = block
    }
    else {
      log("tap: failed to register default input device listener (\(status))")
    }
  }

  private func unregisterDefaultInputDeviceListener() {
    guard let block = defaultInputListenerBlock else { return }
    var address = AudioObjectPropertyAddress(
      mSelector: kAudioHardwarePropertyDefaultInputDevice,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    AudioObjectRemovePropertyListenerBlock(
      AudioObjectID(kAudioObjectSystemObject), &address, deviceListenerQueue, block
    )
    defaultInputListenerBlock = nil
  }

  // ── 采集管线搭建 ──

  /**
   * pids 非空 → 仅混入这些进程(include);为空 → 全系统混音并排除 excludePids(exclude)
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
      kAudioAggregateDeviceNameKey: "ElectronApp-Tap",
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
   * 预建才支持「录音中热挂/卸 tap 与 mic」。零样本空轨由 mixTracks 零时长过滤剔除
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

    let mInput = AVAssetWriterInput(mediaType: .audio, outputSettings: aacMicSettings(), sourceFormatHint: micFormatDescription)
    mInput.expectsMediaDataInRealTime = true
    w.add(mInput)

    w.startWriting()

    writer = w
    systemInput = sysInput
    micInput = mInput
    checkpointWriter = AudioCheckpointWriter(
      outputPath: outputPath,
      systemSettings: aacSystemAudioSettings(sampleRate: sampleRate),
      systemSourceFormatHint: tapFormatDescription,
      micSettings: aacMicSettings(),
      micSourceFormatHint: micFormatDescription
    )
    sessionStarted = false
  }

  /**
   * 起 mic 采集引擎（VPIO AEC 或裸采集）;mic 轨恒预建,此处只负责「开始进样」
   *
   * 录音中热挂时:VPIO 启动会重配置输出设备,可能扰动正在跑的 tap——若实测有此问题,
   * 需改为「tap 正跑时挂 mic 强制走裸采集」或「重挂 tap」策略。返回是否成功挂上
   */
  @discardableResult
  private func attachMic(aec: Bool) -> Bool {
    guard !isMicActive() else { return true }
    let micGeneration = beginMicGeneration()
    resetMicTimingState(preservingEmittedTimeline: true)
    guard prepareMicCapture(aec: aec, generation: micGeneration) else {
      invalidateMicGeneration()
      return false
    }

    /** AVAudioEngine 路径 captureSession 为 nil;AVCapture 路径可能已在首帧探测中启动 */
    if let captureSession, !captureSession.isRunning {
      captureSession.startRunning()
    }
    setMicActive(true)
    /** 重挂 mic 后重置 mic 轨 gap 基准:关麦超阈值再开麦时,陈旧时间戳会让下一个 tick 抢在新引擎首帧前误报掉线 */
    micLastSampleAt = Date()
    /** 挂上即视为一次成功恢复:清零退避,后续再掉线可重新走满 MIC_RECOVERY_MAX_ATTEMPTS */
    resetMicRecoveryBackoff()
    return true
  }

  /** 停 mic 采集引擎,micInput 保留(恒预建);已采集的 mic 样本仍在产物中 */
  private func detachMic() {
    guard isMicActive() else { return }
    /** 先让旧 callback 失效，再进入任何可能阻塞的 Core Audio 同步调用 */
    invalidateMicGeneration()

    captureSession?.stopRunning()
    captureSession = nil

    if let engine = audioEngine {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
      audioEngine = nil
    }
    micFormatDescription = nil
    setMicActive(false)
    /** 排空采样队列里 detach 前已入队的 mic 回调，避免其与随后 attachMic 的时间轴状态重置跨线程并发 */
    sampleQueue.sync {}
    /** 排空后再清转换器缓存:队列里残留的 sidecar 写入会按需重建它,先清会被写回 */
    micSidecarConverter = nil
    micSidecarConverterSourceFormat = nil
  }

  /**
   * mic 采集引擎选择:
   * 1. AVAudioEngine voice processing(苹果 AEC)
   * 2. raw AVAudioEngine(短重试后写 sidecar)
   * 3. AVCaptureSession 作为最后兜底(也写 sidecar,不再进实时 AAC mic writer)
   */
  private func prepareMicCapture(aec: Bool, generation: UUID) -> Bool {
    if aec, prepareVoiceProcessedMic(generation: generation) {
      return true
    }
    if prepareRawAudioEngineMicWithRetry(generation: generation) {
      return true
    }
    return prepareCaptureSessionMic(generation: generation)
  }

  private func prepareRawAudioEngineMicWithRetry(generation: UUID) -> Bool {
    for attempt in 1...RAW_AUDIO_ENGINE_START_ATTEMPTS {
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
      }
    }

    return false
  }

  private func prepareVoiceProcessedMic(generation: UUID) -> Bool {
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
      releaseVoiceProcessingMic(input: input, engine: engine)
      return false
    }
    guard format.channelCount <= 2 else {
      log("tap: voice processing mic format \(format.channelCount)ch is not writer-compatible, fallback to raw capture")
      releaseVoiceProcessingMic(input: input, engine: engine)
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
      releaseVoiceProcessingMic(input: input, engine: engine)
      return false
    }
    micFormatDescription = micFmtDesc

    let callbackBaseline = micCallbackCount
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, when in
      self?.handleMicBuffer(buffer, at: when, generation: generation)
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

    guard waitForFirstMicSample(after: callbackBaseline, label: "voice-processed audio engine") else {
      input.removeTap(onBus: 0)
      releaseVoiceProcessingMic(input: input, engine: engine)
      log("tap: voice-processed audio engine started but no samples in \(Int(MIC_FIRST_SAMPLE_PROBE_TIMEOUT_SEC * 1000))ms, fallback to raw capture")
      return false
    }

    audioEngine = engine
    log("tap: mic via voice-processed AVAudioEngine (\(Int(format.sampleRate))Hz/\(format.channelCount)ch)")
    return true
  }

  private func prepareRawAudioEngineMic(generation: UUID) -> MicEnginePrepareResult {
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
      log("tap: raw audio engine mic format description failed, fallback to AVCaptureSession")
      return .finalFailure
    }
    micFormatDescription = micFmtDesc

    let callbackBaseline = micCallbackCount
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, when in
      self?.handleMicBuffer(buffer, at: when, generation: generation)
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

    guard waitForFirstMicSample(after: callbackBaseline, label: "raw audio engine") else {
      input.removeTap(onBus: 0)
      engine.stop()
      audioEngine = nil
      log("tap: raw audio engine started but no samples in \(Int(MIC_FIRST_SAMPLE_PROBE_TIMEOUT_SEC * 1000))ms, treating as transient failure")
      return .retryableFailure
    }

    audioEngine = engine
    log("tap: mic via raw AVAudioEngine (\(Int(format.sampleRate))Hz/\(format.channelCount)ch, no AEC)")
    return .ready
  }

  private func prepareCaptureSessionMic(generation: UUID) -> Bool {
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
      registerCaptureOutput(output, generation: generation)

      let callbackBaseline = micCallbackCount
      session.startRunning()
      guard waitForFirstMicSample(after: callbackBaseline, label: "AVCaptureSession") else {
        session.stopRunning()
        output.setSampleBufferDelegate(nil, queue: nil)
        log("tap: AVCaptureSession started but no samples in \(Int(MIC_FIRST_SAMPLE_PROBE_TIMEOUT_SEC * 1000))ms, system audio only")
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

  private func waitForFirstMicSample(after baseline: Int, label: String) -> Bool {
    let deadline = Date().addingTimeInterval(MIC_FIRST_SAMPLE_PROBE_TIMEOUT_SEC)
    while Date() < deadline {
      if micCallbackCount > baseline {
        return true
      }
      Thread.sleep(forTimeInterval: MIC_FIRST_SAMPLE_PROBE_INTERVAL_SEC)
    }

    if micCallbackCount > baseline {
      return true
    }

    log("tap: \(label) produced no mic callbacks during first-sample probe")
    return false
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
   * tap PCM(AudioBufferList)→ CMSampleBuffer → 系统音轨;PTS 用 host time,与 mic 轨同时基
   *
   * IOProc 的 ABL 含聚合设备全部输入流,不止 tap 一路:VPIO(mic AEC)开启时,
   * 输出子设备会多出一条回声参考流(实测 4ch,排在 tap 之前),必须按 tap 格式的
   * 声道数扫描定位 tap 流,固定取第一个 buffer 会拿到参考流并因尺寸不符全量丢样
   */
  private func handleTapBuffer(_ bufferList: UnsafePointer<AudioBufferList>, _ inputTime: UnsafePointer<AudioTimeStamp>) {
    tapCallbackCount += 1
    guard shouldAcceptTapSamples(), !paused else { return }
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

  /** mic 轨(降级路径):AVCaptureSession 回调(与 tap 同队列串行),同样写 sidecar 避开实时 AAC writer */
  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let generation = captureGeneration(for: output),
          shouldAcceptMicSamples(generation: generation),
          !paused,
          sampleBuffer.isValid
    else { return }
    micCallbackCount += 1
    guard let pcmBuffer = copyPCMBuffer(from: sampleBuffer) else {
      micConvertFailCount += 1
      return
    }

    writeMicSidecarBuffer(pcmBuffer, sourcePTS: CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
  }

  /** mic 轨(VPIO 路径):AVAudioEngine tap 回调在引擎内部线程,拷贝为 CMSampleBuffer 后进采样串行队列 */
  private func handleMicBuffer(_ buffer: AVAudioPCMBuffer, at when: AVAudioTime, generation: UUID) {
    micCallbackCount += 1
    guard shouldAcceptMicSamples(generation: generation), !paused, buffer.frameLength > 0 else { return }
    guard let copied = copyPCMBuffer(buffer) else {
      micConvertFailCount += 1
      return
    }

    sampleQueue.async { [weak self] in
      guard let self else { return }
      guard self.shouldAcceptMicSamples(generation: generation) else { return }
      self.writeMicSidecarBuffer(copied, at: when)
    }
  }

  /**
   * 给 sampleQueue 投递一个尾部哨兵并有界等待。等待发生在独立任务中，不占 stdin command
   * chain；超时只表示不能安全 finalize，不会尝试取消或并发访问队列内仍在执行的任务
   */
  private func drainSampleQueue(timeout: TimeInterval) async -> Bool {
    await withCheckedContinuation { continuation in
      let resolution = SampleQueueDrainResolution(continuation)
      sampleQueue.async {
        resolution.resolve(true)
      }
      DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + timeout) {
        resolution.resolve(false)
      }
    }
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
      if micConvertFailCount == 0 {
        log("tap: AVCapture PCM format unavailable")
      }
      return nil
    }

    let frameCount = CMSampleBufferGetNumSamples(sampleBuffer)
    guard frameCount > 0, frameCount <= Int(Int32.max) else {
      if micConvertFailCount == 0 {
        log("tap: AVCapture PCM frame count invalid: \(frameCount)")
      }
      return nil
    }

    guard let buffer = AVAudioPCMBuffer(
      pcmFormat: format,
      frameCapacity: AVAudioFrameCount(frameCount)
    ) else {
      if micConvertFailCount == 0 {
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
      if micConvertFailCount == 0 {
        log("tap: AVCapture PCM copy failed \(status)")
      }
      return nil
    }

    return buffer
  }

  private func writeMicSidecarBuffer(_ buffer: AVAudioPCMBuffer, at when: AVAudioTime) {
    let pts = when.isHostTimeValid
      ? CMClockMakeHostTimeFromSystemUnits(when.hostTime)
      : CMClockGetTime(CMClockGetHostTimeClock())

    writeMicSidecarBuffer(buffer, sourcePTS: pts)
  }

  private func writeMicSidecarBuffer(_ buffer: AVAudioPCMBuffer, sourcePTS: CMTime) {
    guard let micSidecarURL else { return }

    do {
      if micAudioFile == nil {
        micAudioFile = try AVAudioFile(
          forWriting: micSidecarURL,
          settings: buffer.format.settings,
          commonFormat: buffer.format.commonFormat,
          interleaved: buffer.format.isInterleaved
        )
        log("tap: mic sidecar started \(micSidecarURL.path)")
      }

      guard let micAudioFile else { return }

      if !micSampleFormatLogged {
        let duration = CMTime(value: CMTimeValue(buffer.frameLength), timescale: CMTimeScale(max(1, Int32(buffer.format.sampleRate.rounded()))))
        log("tap: mic sidecar format rate=\(Int(buffer.format.sampleRate))Hz channels=\(buffer.format.channelCount) commonFormat=\(buffer.format.commonFormat.rawValue) interleaved=\(buffer.format.isInterleaved) frameLength=\(buffer.frameLength) sourcePTS=\(formatCMTimeSeconds(sourcePTS)) bufferDuration=\(formatCMTimeSeconds(duration))")
        micSampleFormatLogged = true
      }

      guard let writableBuffer = micSidecarBufferForWrite(buffer, targetFormat: micAudioFile.processingFormat) else {
        micDropCount += 1
        return
      }

      try micAudioFile.write(from: writableBuffer)
      micAppendCount += 1
      micLastSampleAt = Date()
    }
    catch {
      micDropCount += 1
      if isStorageInsufficientError(error) && micSidecarWriteError == nil {
        micSidecarWriteError = error
        log("tap: mic sidecar storage insufficient: \(describeError(error))")
      }
      if micDropCount == 1 {
        log("tap: mic sidecar write failed: \(describeError(error))")
      }
    }
  }

  private func micSidecarBufferForWrite(_ buffer: AVAudioPCMBuffer, targetFormat: AVAudioFormat) -> AVAudioPCMBuffer? {
    guard !isSameAudioFormat(buffer.format, targetFormat) else { return buffer }

    if !micSidecarFormatConversionLogged {
      log("tap: mic sidecar converting format source=\(describeAudioFormat(buffer.format)) target=\(describeAudioFormat(targetFormat))")
      micSidecarFormatConversionLogged = true
    }

    /** 复用缓存的转换器;仅 source format 变化(设备切换)才重建。target 绑定 micAudioFile.processingFormat,文件生命周期内恒定 */
    if micSidecarConverter == nil
      || micSidecarConverterSourceFormat.map({ !isSameAudioFormat($0, buffer.format) }) ?? true {
      micSidecarConverter = AVAudioConverter(from: buffer.format, to: targetFormat)
      micSidecarConverterSourceFormat = buffer.format
    }
    guard let converter = micSidecarConverter else {
      if micDropCount == 0 {
        log("tap: mic sidecar converter unavailable source=\(describeAudioFormat(buffer.format)) target=\(describeAudioFormat(targetFormat))")
      }
      return nil
    }

    let sampleRateRatio = targetFormat.sampleRate / max(1, buffer.format.sampleRate)
    let frameCapacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * sampleRateRatio)) + 16
    guard let converted = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: max(1, frameCapacity)) else {
      if micDropCount == 0 {
        log("tap: mic sidecar conversion buffer allocation failed")
      }
      return nil
    }

    var didProvideInput = false
    var conversionError: NSError?
    let status = converter.convert(to: converted, error: &conversionError) { _, outStatus in
      guard !didProvideInput else {
        outStatus.pointee = .noDataNow
        return nil
      }

      didProvideInput = true
      outStatus.pointee = .haveData
      return buffer
    }

    guard status != .error, conversionError == nil, converted.frameLength > 0 else {
      if micDropCount == 0 {
        log("tap: mic sidecar conversion failed status=\(status.rawValue) error=\(describeError(conversionError))")
      }
      return nil
    }

    return converted
  }

  private func isSameAudioFormat(_ lhs: AVAudioFormat, _ rhs: AVAudioFormat) -> Bool {
    abs(lhs.sampleRate - rhs.sampleRate) < 0.5
      && lhs.channelCount == rhs.channelCount
      && lhs.commonFormat == rhs.commonFormat
      && lhs.isInterleaved == rhs.isInterleaved
  }

  private func describeAudioFormat(_ format: AVAudioFormat) -> String {
    let asbd = format.streamDescription.pointee
    return "\(Int(format.sampleRate))Hz/\(format.channelCount)ch common=\(format.commonFormat.rawValue) interleaved=\(format.isInterleaved) format=\(asbd.mFormatID) flags=\(asbd.mFormatFlags) bytesPerFrame=\(asbd.mBytesPerFrame) bits=\(asbd.mBitsPerChannel)"
  }

  /** VPIO buffer 转成 CMSampleBuffer；mic PTS 统一在 appendSample 内修正，保证 VPIO / raw AVCapture 共用同一时间轴策略。 */
  private func makeSampleBuffer(from buffer: AVAudioPCMBuffer, at when: AVAudioTime) -> CMSampleBuffer? {
    guard let formatDescription = micFormatDescription else { return nil }

    let rawPTS = when.isHostTimeValid
      ? CMClockMakeHostTimeFromSystemUnits(when.hostTime)
      : CMClockGetTime(CMClockGetHostTimeClock())
    let sampleRate = max(1, Int32(buffer.format.sampleRate.rounded()))
    let sampleDuration = CMTime(value: 1, timescale: CMTimeScale(sampleRate))

    var timing = CMSampleTimingInfo(
      duration: sampleDuration,
      presentationTimeStamp: rawPTS,
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

  private func correctedMicPTS(rawPTS: CMTime, bufferDuration: CMTime) -> CMTime {
    /** referenceDuration 取「上一帧」时长做压缩判据参照（defer 在函数退出后才更新，故此处仍是上一帧值） */
    let referenceDuration = micLastBufferDuration ?? bufferDuration
    defer {
      micLastRawPTS = rawPTS
      micLastBufferDuration = bufferDuration
    }

    guard let expectedPTS = micNextPTS else {
      let pts = correctedMicPTSAtOrAfterTimeline(rawPTS, fallbackPTS: rawPTS)
      micNextPTS = CMTimeAdd(pts, bufferDuration)
      return pts
    }

    if isMicRawPTSUnusable(rawPTS: rawPTS, referenceDuration: referenceDuration) || FORCE_SYNTHETIC_MIC_TIMELINE {
      micSyntheticPTSActive = true
    }

    let candidatePTS = micSyntheticPTSActive
      ? expectedPTS
      : rawPTS
    let pts = correctedMicPTSAtOrAfterTimeline(candidatePTS, fallbackPTS: expectedPTS)
    if CMTimeCompare(pts, candidatePTS) != 0 {
      micSyntheticPTSActive = true
    }
    if micSyntheticPTSActive {
      micPtsSyntheticCount += 1
    }

    micNextPTS = CMTimeAdd(pts, bufferDuration)
    return pts
  }

  private func correctedMicPTSAtOrAfterTimeline(_ pts: CMTime, fallbackPTS: CMTime) -> CMTime {
    /** 首帧（micNextPTS 尚未建立）直接放行；后续帧以 fallbackPTS（= micNextPTS）为不可回退下限 */
    guard micNextPTS != nil else { return pts }
    guard pts.isValid, fallbackPTS.isValid else { return fallbackPTS }

    if CMTimeCompare(pts, fallbackPTS) < 0 {
      return fallbackPTS
    }

    return pts
  }

  /** referenceDuration 传「上一帧」的 buffer 时长：相邻帧 raw PTS 间距语义上≈上一帧时长，变长帧下才准确 */
  private func isMicRawPTSUnusable(rawPTS: CMTime, referenceDuration: CMTime) -> Bool {
    guard let lastRawPTS = micLastRawPTS else { return false }

    let rawDelta = CMTimeSubtract(rawPTS, lastRawPTS)
    let rawDeltaSeconds = rawDelta.seconds
    let expectedSeconds = referenceDuration.seconds

    if !rawDeltaSeconds.isFinite || rawDeltaSeconds < 0 {
      micPtsRegressCount += 1
      return true
    }

    if rawDeltaSeconds == 0 {
      micPtsFrozenCount += 1
      return true
    }

    if expectedSeconds.isFinite, expectedSeconds > 0, rawDeltaSeconds < expectedSeconds * 0.25 {
      micPtsCompressedCount += 1
      return true
    }

    return false
  }

  private func resetMicTimingState(preservingEmittedTimeline: Bool = false) {
    micLastRawPTS = nil
    micLastBufferDuration = nil
    if !preservingEmittedTimeline {
      micNextPTS = nil
    }
    micSyntheticPTSActive = false
  }

  private func shiftMicTimeline(by duration: CMTime) {
    guard duration.isValid, duration.seconds.isFinite else { return }
    if let nextPTS = micNextPTS {
      micNextPTS = CMTimeAdd(nextPTS, duration)
    }
  }

  private func appendSample(_ sampleBuffer: CMSampleBuffer, to input: AVAssetWriterInput?) {
    guard let writer, writer.status == .writing else { return }

    let timelineSample = input === micInput
      ? retimedMicSample(sampleBuffer)
      : sampleBuffer
    /** 暂停时段从时间轴剔除:两轨样本 PTS 统一回拨 pauseOffset,保持相互对齐 */
    let adjusted = retimedForPauseOffset(timelineSample)

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
        checkpointWriter?.append(adjusted, track: .system)
        sysLastSampleAt = Date()
      }
      else {
        micAppendCount += 1
        checkpointWriter?.append(adjusted, track: .mic)
        micLastSampleAt = Date()
      }
    }
    else if input === systemInput {
      sysDropCount += 1
    }
    else {
      micDropCount += 1
    }
  }

  /**
   * mic 轨统一时间轴修正
   *
   * 真实机器上见到两类塌缩:
   * - VPIO 7ch/9ch: mic 数据持续到达,但 hostTime 基本不前进
   * - fallback raw AVCapture: 系统给的 CMSampleBuffer append 成功,最终 track 仍只有 0.064s
   *
   * 因此 mic 写入不直接信任来源 PTS。来源 PTS 只作为首帧锚点和异常检测输入;一旦发现冻结/回退/压缩,
   * 后续按「上一帧 PTS + sampleCount / sampleRate」递推,保住真实录制时长
   */
  private func retimedMicSample(_ sampleBuffer: CMSampleBuffer) -> CMSampleBuffer {
    guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
          let streamDescription = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription)
    else { return sampleBuffer }

    let sampleRateValue = streamDescription.pointee.mSampleRate
    let sampleRate = max(1, Int32((sampleRateValue.isFinite && sampleRateValue > 0 ? sampleRateValue : 48000).rounded()))
    let sampleCount = max(1, CMSampleBufferGetNumSamples(sampleBuffer))
    let sourceDuration = CMSampleBufferGetDuration(sampleBuffer)
    let fallbackDuration = CMTime(value: CMTimeValue(sampleCount), timescale: CMTimeScale(sampleRate))
    let bufferDuration = sourceDuration.isValid && sourceDuration.seconds.isFinite && sourceDuration.seconds > 0
      ? sourceDuration
      : fallbackDuration
    let sampleDuration = CMTimeMultiplyByRatio(bufferDuration, multiplier: 1, divisor: Int32(sampleCount))
    let sourcePTS = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    let rawPTS = sourcePTS.isValid
      ? sourcePTS
      : (micNextPTS ?? CMClockGetTime(CMClockGetHostTimeClock()))
    let pts = correctedMicPTS(rawPTS: rawPTS, bufferDuration: bufferDuration)

    if !micSampleFormatLogged {
      let asbd = streamDescription.pointee
      log("tap: mic sample format rate=\(sampleRate)Hz channels=\(asbd.mChannelsPerFrame) format=\(asbd.mFormatID) flags=\(asbd.mFormatFlags) framesPerPacket=\(asbd.mFramesPerPacket) bytesPerFrame=\(asbd.mBytesPerFrame) bits=\(asbd.mBitsPerChannel) sampleCount=\(sampleCount) sourcePTS=\(formatCMTimeSeconds(sourcePTS)) sourceDuration=\(formatCMTimeSeconds(sourceDuration)) syntheticPTS=\(formatCMTimeSeconds(pts)) bufferDuration=\(formatCMTimeSeconds(bufferDuration))")
      micSampleFormatLogged = true
    }

    var timing = CMSampleTimingInfo(
      duration: sampleDuration,
      presentationTimeStamp: pts,
      decodeTimeStamp: .invalid
    )
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

  private func stopCapturePipeline(skipMicTeardown: Bool = false) {
    teardownTapPipeline()
    tapActive = false
    if skipMicTeardown {
      /**
       * recovery 可能卡在同步系统调用；callback generation 已关闭，stop 只会有界等待 sampleQueue
       * 不在 stop 路径并发销毁同一 engine，交给 stopped 后的 helper 进程回收
       */
      setMicActive(false)
    }
    else {
      detachMic()
    }
  }

  private func cleanup(skipMicTeardown: Bool = false) {
    if !skipMicTeardown {
      stopCapturePipeline()
    }
    /** skip 时 lifecycle owner 仍可能在 Core Audio 内；不再触碰其状态，物理资源与实例字段随 helper 回收 */
    writer = nil
    checkpointWriter = nil
    systemInput = nil
    micInput = nil
    micAudioFile = nil
    micSidecarWriteError = nil
    micSidecarURL = nil
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
    sysLastSampleAt = nil
    micLastSampleAt = nil
    unregisterDefaultInputDeviceListener()
    micRequested = false
    resetMicRecoveryBackoff()
    if !skipMicTeardown {
      cancelMicRecoveryForStop()
    }
    tapFormat = nil
    tapFormatDescription = nil
    if !skipMicTeardown {
      micFormatDescription = nil
      micSidecarConverter = nil
      micSidecarConverterSourceFormat = nil
    }
    receivedNonSilentBuffer = false
    silentBufferCount = 0
    tapCallbackCount = 0
    sysAppendCount = 0
    sysDropCount = 0
    micCallbackCount = 0
    micConvertFailCount = 0
    micAppendCount = 0
    micDropCount = 0
    resetMicTimingState()
    micPtsFrozenCount = 0
    micPtsRegressCount = 0
    micPtsCompressedCount = 0
    micPtsSyntheticCount = 0
    micSampleFormatLogged = false
    micSidecarFormatConversionLogged = false
  }
}

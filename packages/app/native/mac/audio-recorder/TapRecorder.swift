// 编排 process tap 系统音、麦克风 sidecar、恢复和最终混音生命周期

import AVFoundation
import Cocoa
import CoreAudio
import CoreMedia

// ── 手动录音引擎:Core Audio process tap(macOS 14.2+) ──
//
// 与会议录音的 ScreenCaptureKit 引擎互斥。差异:
// - 权限:只需「System Audio Recording Only」TCC(kTCCServiceAudioCapture),不需要屏幕录制
// - 支持按进程过滤:pids 非空 = 仅混入这些进程;pids 为空 = 全系统混音并排除 excludePids(自身进程族)
// - 系统音轨可热挂/卸:tapEnabled=false 纯 mic 开录(系统音轨预建空轨),录音中经 update 随时挂上/摘下 tap
// - 麦克风:优先 AVAudioEngine voice processing(苹果 AEC/NS/AGC),
//   失败依次降级 raw AVAudioEngine 和 AVCaptureSession
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

/** 串行队列尾部哨兵与 timeout 竞争时只恢复 continuation 一次 */
private final class QueueDrainResolution: @unchecked Sendable {
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

// MARK: - Tap 手动录音引擎（process tap 主轨 + mic PCM sidecar，macOS 14.2+）

@available(macOS 14.2, *)
class TapRecorder: NSObject {
  /** tap IOProc 与 mic 回调共用一条串行队列,保证 writer 启动会话与 append 无竞态 */
  private let sampleQueue = DispatchQueue(label: "tap-recorder", qos: .userInitiated)
  /** process tap 的描述、Core Audio 资源、PCM 归一化与统计由独立对象持有 */
  private lazy var tapCapture = TapProcessCapture(
    sampleQueue: sampleQueue,
    shouldAcceptSamples: { [weak self] in
      guard let self else { return false }
      return self.shouldAcceptTapSamples()
    },
    consumeSample: { [weak self] sampleBuffer in
      self?.appendSystemSample(sampleBuffer) ?? .ignored
    }
  )
  /** 物理麦克风采集与降级顺序由独立对象持有，TapRecorder 只接收已拷贝的 PCM */
  private lazy var micCapture = TapMicCapture(
    sampleQueue: sampleQueue,
    onSample: { [weak self] buffer, captureHostTime, processingMode in
      self?.appendMicSample(
        buffer,
        captureHostTime: captureHostTime,
        processingMode: processingMode
      )
    }
  )
  /** 开录完成后，mic / tap 管线变更的唯一物理生命周期执行队列 */
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
  /** mic PCM 文件、格式转换和电平处理的唯一状态所有者 */
  private var micSidecarWriter: TapMicSidecarWriter?
  /** host time、暂停偏移、样本 cutoff 和系统音连续片段的唯一状态所有者 */
  private let recordingTimeline = TapRecordingTimeline()
  /** 录音中重新 attach mic 复用的 AEC 偏好(start 时传入) */
  private var micAecPref = true
  private var outputPath = ""
  private var startTime: Date?
  private var totalPausedDuration: TimeInterval = 0
  private var pausedAt: Date?
  private var sessionStarted = false
  /**
   * 暂停时段累计的 host-time 偏移:恢复后所有样本 PTS 统一回拨该值,产物里不留暂停间隙——
   * 与 web MediaRecorder.pause 的时间轴语义对齐,保证转写时间戳与笔记 elapsed 一致
   */
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
  private var tapRequested = false
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
  /** mic recovery 的逻辑状态所有者：调度、取消、在飞标记与 callback gate 全在同一锁内；物理换代由 TapMicCapture 持有 */
  private let micRecoveryLock = NSLock()
  /** watchdog 输出与 stop 的代际切换串行化，但不在 micRecoveryLock 内执行 stdout I/O */
  private let recordingOutputLock = NSLock()
  private var micRecoveryToken: UUID?
  private var micRecoveryWorkItem: DispatchWorkItem?
  private var micRecoveryInFlight = false
  private var micRecoveryRerunReason: String?
  private var recordingGeneration = UUID()
  private var recordingFinalizing = false
  private var acceptMicSamples = false
  /** 暂停期间被采样闸门吞掉的默认输入设备变更；resume 据此决定是否需要重挂 mic */
  private var micDeviceChangedWhilePaused = false
  private var acceptTapSamples = false
  private var micRecoveryRequested = false

  /** 已授权后的启动预检：只验证麦克风路线，不创建 Writer、系统 Tap、恢复任务或录音产物 */
  func probeMic(aec: Bool) async {
    guard writer == nil else {
      emitError("already_recording")
      return
    }

    guard micCapture.attach(aec: aec) != nil,
          let strategy = micCapture.activeStrategy,
          let deviceKey = micCapture.activeDeviceKey
    else {
      micCapture.detach()
      emitDiagnostic("mic_probe_failed", detail: "no_capture_source")
      return
    }

    micCapture.detach()
    emitMicProbeComplete(strategy: strategy, deviceKey: deviceKey)
  }

  @discardableResult
  func start(
    outputPath: String,
    pids: [pid_t],
    excludePids: [pid_t],
    withMic: Bool,
    tapEnabled: Bool,
    micAec: Bool,
    preferredMicStrategy: MicCaptureStrategy?,
    preferredMicDeviceKey: String?
  ) async -> Bool {
    guard writer == nil else {
      emitError("already_recording")
      return false
    }

    beginRecordingGeneration(micRequested: withMic, tapRequested: tapEnabled)
    self.outputPath = outputPath
    self.micAecPref = micAec
    self.micRequested = withMic
    self.tapRequested = tapEnabled
    sampleQueue.sync {
      micSidecarWriter = TapMicSidecarWriter(outputPath: outputPath)
    }

    do {
      /**
       * 顺序约束:先起 mic 引擎再建 tap 管线——VPIO(AEC)启动会重配置输出设备,
       * 之后读到的 tap 格式才与实际回调一致;mic 设备不可用时降级为仅系统音频,
       * 不整体失败(mic 权限由 TS 侧前置保证)
       */
      let recordingGeneration = currentRecordingGeneration()
      let micReady = withMic
        ? attachMic(
          aec: micAec,
          generation: recordingGeneration,
          preferredStrategy: preferredMicStrategy,
          preferredDeviceKey: preferredMicDeviceKey
        ) != nil
        : false
      guard tapEnabled || micReady else {
        throw TapRecorderError("no_capture_source")
      }

      /** tapEnabled=false:纯 mic 开录,系统音轨预建空轨,后续可经 update 热挂 tap */
      if tapEnabled {
        let description = try tapCapture.makeDescription(pids: pids, excludePids: excludePids)
        try tapCapture.prepare(description)
      }
      /** 主 writer 只写系统音，mic 独立写 PCM sidecar，停止后离线混入 */
      try setupWriter(outputPath: outputPath)

      if tapEnabled {
        try tapCapture.start()
      }

      startTime = Date()
      recordingTimeline.begin()
      /** attach 的首帧探测发生在 writer 就绪前，先排空探测期间排队的 callback 再开放写入 */
      sampleQueue.sync {}
      setTapSampleGate(tapEnabled)
      if withMic {
        enableMicSampleGate()
      }
      startFirstSampleWatchdog()
      startSampleGapWatchdog()
      /** HAL 设备监听登记一次即覆盖整场(含日后 update 热挂 mic),独立于 mic 引擎存活 */
      registerDefaultInputDeviceListener()
      log("tap start: mic=\(micReady) tap=\(tapEnabled) devices: \(describeDefaultAudioDevices())")
      emitStatus(
        "recording",
        path: outputPath,
        micStrategy: micCapture.activeStrategy,
        micDeviceKey: micCapture.activeDeviceKey
      )
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
   * - mic：micEnabled 切换物理 mic 采集，已写入的 sidecar 样本保留
   * - tap：tapEnabled=false 拆 tap 管线；true 且未挂载则新建；true 且已挂载则重建（变更进程集合）
   *
   * 主 writer 只有系统音轨，物理音源切换不修改 writer 轨结构
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
    tapRequested = tapEnabled
    setMicRecoveryRequested(micEnabled)
    if micEnabled, !recordingTimeline.isPaused {
      enableMicSampleGate()
    }
    else {
      disableMicSampleGate()
      cancelScheduledMicRecovery()
    }
    setTapSampleGate(tapEnabled && !recordingTimeline.isPaused)

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
    generation: UUID,
    tapEnabled: Bool,
    micEnabled: Bool,
    pids: [pid_t],
    excludePids: [pid_t]
  ) {
    guard isRecordingGenerationCurrent(generation) else { return }

    if micEnabled, !isMicActive() {
      guard resetMicRecoveryBackoff(for: generation) else { return }
      if attachMic(aec: micAecPref, generation: generation) != nil {
        log("mic attached")
      }
      else {
        log("mic attach failed, no mic capture")
      }
      guard isRecordingGenerationCurrent(generation) else {
        return
      }
    }
    else if !micEnabled, isMicActive() {
      detachMic()
      log("mic detached")
    }

    if !tapEnabled {
      guard isRecordingGenerationCurrent(generation) else { return }
      if tapCapture.isActive {
        tapCapture.teardown()
        log("tap detached")
      }
      return
    }

    let description: CATapDescription
    do {
      description = try tapCapture.makeDescription(pids: pids, excludePids: excludePids)
    }
    catch {
      log("tap update rejected: \((error as? TapRecorderError)?.message ?? error.localizedDescription)")
      return
    }

    guard isRecordingGenerationCurrent(generation) else { return }
    if tapCapture.isActive {
      tapCapture.teardown()
    }
    guard isRecordingGenerationCurrent(generation) else { return }

    do {
      try tapCapture.prepare(description)
      guard isRecordingGenerationCurrent(generation) else {
        tapCapture.teardown()
        return
      }
      try tapCapture.start()
      guard isRecordingGenerationCurrent(generation) else {
        tapCapture.teardown()
        return
      }
      log("tap attached: pids=[\(pids.map(String.init).joined(separator: ","))]")
    }
    catch {
      /** 罕见:旧管线已拆、新管线失败——mic 轨继续录,系统音轨静默缺失,只能日志留痕
       * 分阶段失败(tap 建成后 aggregate/IOProc 抛错)会留下半建的内核对象句柄,
       * 必须拆干净(teardown 对 kAudioObjectUnknown 幂等),否则下次重试覆盖 ID 永久泄漏 */
      tapCapture.teardown()
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

      guard isRecordingGenerationCurrent(update.generation) else {
        log("tap: stale capture update discarded")
        continue
      }
      applyCaptureUpdate(
        generation: update.generation,
        tapEnabled: update.tapEnabled,
        micEnabled: update.micEnabled,
        pids: update.pids,
        excludePids: update.excludePids
      )
    }
  }

  func pause() {
    guard writer != nil, !recordingTimeline.isPaused else { return }
    recordingTimeline.pause()
    disableMicSampleGate()
    setTapSampleGate(false)
    cancelScheduledMicRecovery()
    /** 新一轮暂停窗口重新记账，不继承上一轮遗留的设备变更 */
    _ = consumeMicDeviceChangedWhilePaused()
    pausedAt = Date()
    /** 排空 pause 边界前已投递的 mic callback，防止 resume 后按新 gate 误收旧样本 */
    sampleQueue.sync {}
    emitStatus("paused", path: outputPath)
  }

  func resume() {
    guard writer != nil, recordingTimeline.isPaused else { return }
    if let pa = pausedAt {
      totalPausedDuration += Date().timeIntervalSince(pa)
      pausedAt = nil
    }
    recordingTimeline.resume()
    if micRequested {
      enableMicSampleGate()
      /**
       * pause 只关采样闸门、从不停止引擎，健康的 VPIO 在 resume 时不需要重挂。
       * 无条件 detach + attach 要付出 settle 延迟、首帧探测和 `!dev` 设备忙重试，
       * 实测在成品里表现为 resume 后约 1.9s 的静音；只有确有理由时才重挂：
       * - 暂停期间换过默认输入设备（该事件当时被闸门吞掉，只能记账后补）
       * - 引擎本就不在活动状态（暂停前已丢麦或重试次数耗尽）
       * 两者都不成立时若引擎仍僵尸化，由 mic 断流看门狗按 MIC_SAMPLE_GAP_TIMEOUT 兜底
       */
      if consumeMicDeviceChangedWhilePaused() {
        requestMicRecovery(reason: "mic-device-changed-while-paused")
      }
      else if !isMicActive() {
        requestMicRecovery(reason: "mic-inactive-on-resume")
      }
    }
    setTapSampleGate(tapRequested)
    /** 恢复后重置两轨基准:暂停时段无样本,陈旧时间戳会让下一 tick 误判掉线 */
    let resumedAt = Date()
    sampleQueue.sync {
      sysLastSampleAt = resumedAt
      micLastSampleAt = resumedAt
    }
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
    /** stop/finalizing 期间不再允许首帧或 gap watchdog 发出录音中 error */
    firstSampleWatchdogToken = UUID()
    sampleGapWatchdogToken = UUID()

    if recordingTimeline.isPaused, let pa = pausedAt {
      totalPausedDuration += Date().timeIntervalSince(pa)
    }

    /** cleanup 会清空 mic 用户意图，零样本收尾前必须先快照 */
    let hadMicAtStop = micRequested

    cancelMicRecoveryForStop()
    clearPendingCaptureUpdate()
    /**
     * stop 永远不调用 stopRunning/removeTap/engine.stop/AudioDeviceStop
     * HAL settle、pending recovery 与任何已挂起 lifecycle 操作都统一视为不安全；
     * callback gate 已原子关闭，文件交接完成后由父进程回收整个 helper
     */
    /**
     * 先以有界异步哨兵等待 lifecycle queue：它可以继续同步访问 sampleQueue，command chain
     * 不会阻塞任一队列。超时后绝不能 finalize writer，保留恢复资产并让父进程回收 helper
     */
    guard await drainQueue(
      micLifecycleQueue,
      timeout: CAPTURE_LIFECYCLE_DRAIN_TIMEOUT_SEC
    ) else {
      let detail = "capture lifecycle queue did not drain within \(CAPTURE_LIFECYCLE_DRAIN_TIMEOUT_SEC)s; preserving recovery assets"
      log("tap: finalize aborted — \(detail)")
      if let handoffId {
        emitRecycleDirective(handoffId: handoffId, detail: detail)
      }
      emitTerminalError("finalize_queue_timeout", path: outputPath, detail: detail, handoffId: handoffId)
      return
    }

    guard await drainQueue(sampleQueue, timeout: SAMPLE_QUEUE_DRAIN_TIMEOUT_SEC) else {
      let detail = "sample queue did not drain within \(SAMPLE_QUEUE_DRAIN_TIMEOUT_SEC)s; preserving recovery assets"
      log("tap: finalize aborted — \(detail)")
      if let handoffId {
        emitRecycleDirective(handoffId: handoffId, detail: detail)
      }
      emitTerminalError("finalize_queue_timeout", path: outputPath, detail: detail, handoffId: handoffId)
      return
    }

    systemInput?.markAsFinished()

    if let writer, writer.status == .writing {
      await writer.finishWriting()
    }
    let checkpoints = checkpointWriter
    checkpoints?.finish()
    let writerStatus = writer?.status
    let writerError = describeError(writer?.error)
    let sidecarSummary = sampleQueue.sync {
      let sidecar = micSidecarWriter
      let summary = (
        writeError: sidecar?.writeError,
        filePath: sidecar?.fileURL.path,
        hasDetectedSignal: sidecar?.hasDetectedSignal ?? false,
        appendCount: sidecar?.appendCount ?? 0,
        dropCount: sidecar?.dropCount ?? 0
      )
      sidecar?.finish()
      return summary
    }
    let finalizedSystemTimeline = recordingTimeline.snapshotSystemSegments()
    let hasStorageWriteError = isStorageInsufficientError(writer?.error)
      || isStorageInsufficientError(sidecarSummary.writeError)
    let storageWriteError = isStorageInsufficientError(writer?.error)
      ? writerError
      : describeError(sidecarSummary.writeError)
    let micSidecarPath = sidecarSummary.filePath
    let hasDetectedMicSignal = sidecarSummary.hasDetectedSignal
    var micSidecarDuration = CMTime.zero
    if let micSidecarPath {
      micSidecarDuration = await readableAudioDuration(URL(fileURLWithPath: micSidecarPath))
    }
    let hasMicSidecarSamples = micSidecarDuration > .zero
    let tapStatistics = tapCapture.statistics
    let didWriteSamples = (tapStatistics.appendCount + sidecarSummary.appendCount) > 0
    if let writer, writer.status == .failed {
      log("tap: writer finish failed: \(writerError)")
    }
    let stats = "tapCb=\(tapStatistics.callbackCount) sysOK=\(tapStatistics.appendCount) sysDrop=\(tapStatistics.dropCount) micCb=\(micCapture.callbackCount) micConvFail=\(micCapture.convertFailCount) micOK=\(sidecarSummary.appendCount) micDrop=\(sidecarSummary.dropCount)"
    log("tap stats: \(stats) devices: \(describeDefaultAudioDevices())")

    let elapsed = startTime.map { Date().timeIntervalSince($0) } ?? 0
    let duration = max(0, elapsed - totalPausedDuration)
    let savedPath = outputPath

    cleanup(preservePhysicalCapture: true)

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
     * 整场没检测到有效 mic 且系统主轨健康时，不能因为 sidecar 里有静音/底噪时长就强制
     * 二次 AAC 编码和多轨 limiter。纯 mic 或主 writer 失败时仍保留 sidecar 作为唯一音源。
     */
    let shouldMixMicSidecar = hasMicSidecarSamples
      && (hasDetectedMicSignal || writerStatus != .completed)
    emitStatus("mixing", path: savedPath)
    let mixed: Bool
    if let micSidecarPath, shouldMixMicSidecar {
      mixed = await mergeMicSidecar(
        sidecarPath: micSidecarPath,
        outputPath: savedPath,
        primaryInputVolume: hasDetectedMicSignal
          ? SYSTEM_AUDIO_VOLUME_WITH_MIC
          : 1,
        primaryTimelineSegments: finalizedSystemTimeline
      )
    }
    else {
      /** 没有有效 mic sidecar 时，纯系统音仍直接走 mixTracks 的单轨路径 */
      mixed = await mixTracks(
        inputPath: savedPath,
        primaryInputVolume: SYSTEM_AUDIO_VOLUME_WITHOUT_MIC,
        primaryTimelineSegments: finalizedSystemTimeline
      )
    }
    guard mixed else {
      /**
       * 不能把未完成的最终产物当作 stopped 交付：上层收到 stopped 后会读取主文件并删除
       * sidecar/checkpoint。terminal error 会结束当前会话但保留恢复资产，供下次扫描重建
       */
      let detail = "final audio render failed; recovery assets preserved"
      log("tap: \(detail)")
      emitRecycleRequired(handoffId: handoffId)
      emitTerminalError("writer_failed", path: savedPath, detail: detail, handoffId: handoffId)
      return
    }
    if let micSidecarPath, !shouldMixMicSidecar {
      removeMicSidecarFile(URL(fileURLWithPath: micSidecarPath), context: "tap stop")
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
              !self.recordingTimeline.isPaused,
              (self.tapCapture.statistics.appendCount + (self.micSidecarWriter?.appendCount ?? 0)) == 0,
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

        if !self.recordingTimeline.isPaused {
          let now = Date()

          /**
           * mic 单轨自愈(仅当用户仍要录麦克风时):
           * - micActive 但持续静默:引擎僵尸化(蓝牙掉线典型),系统音轨仍刷新 sysLastSampleAt、整体不超时,
           *   只能按 mic 独立时间戳发现 → 重挂(detach + re-attach 到当前默认输入设备)
           * - !micActive:上一次重挂失败已丢麦,未达重试上限则周期重挂;达上限即停手,交由 HAL 设备变更监听在复联时拉起
           */
          if self.isMicRecoveryRequested() {
            if self.isMicActive() {
              if let micAt = self.micLastSampleAt,
                 now.timeIntervalSince(micAt) >= MIC_SAMPLE_GAP_TIMEOUT {
                let micGap = Int(now.timeIntervalSince(micAt))
                log("tap: mic sample gap \(micGap)s (micCb=\(self.micCapture.callbackCount) micOK=\(self.micSidecarWriter?.appendCount ?? 0)), requesting mic recovery, devices: \(describeDefaultAudioDevices())")
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
              detail: "no samples for \(gap)s, sysOK=\(self.tapCapture.statistics.appendCount) micOK=\(self.micSidecarWriter?.appendCount ?? 0), devices: \(describeDefaultAudioDevices())"
            )
            return
          }
        }

        self.scheduleSampleGapWatchdog(token, generation: generation, path: path)
      }
    }
  }

  /**
   * 独立输出锁把 generation 校验和 NDJSON 写入与 stop 的代际切换串行化，
   * 不在 mic recovery 状态锁内执行 stdout I/O
   */
  private func emitWatchdogError(
    _ error: String,
    generation: UUID,
    path: String,
    detail: String
  ) {
    emitIfRecordingCurrent(generation: generation) {
      emitRecordingError(error, path: path, detail: detail)
    }
  }

  /** generation 校验与 NDJSON 输出必须和 stop 的代际切换原子化 */
  private func emitIfRecordingCurrent(generation: UUID, output: () -> Void) {
    recordingOutputLock.lock()
    defer { recordingOutputLock.unlock() }
    let mayEmit = micRecoveryLock.withLock {
      recordingGeneration == generation && !recordingFinalizing
    }
    guard mayEmit else { return }
    output()
  }

  /** 在挂音源中最近一次出样时刻(取 tap / mic 两轨较新者);无任何在挂源返回 nil */
  private func mostRecentActiveSampleAt() -> Date? {
    var latest: Date?
    if tapCapture.isActive, let sys = sysLastSampleAt {
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

  /** start 与 recovery claim 共用同一录音代际，物理 callback 代际由 TapMicCapture 独立校验 */
  private func beginRecordingGeneration(micRequested: Bool, tapRequested: Bool) {
    micCapture.resetStatistics()
    micRecoveryLock.lock()
    micRecoveryWorkItem?.cancel()
    micRecoveryWorkItem = nil
    micRecoveryToken = nil
    micRecoveryRerunReason = nil
    recordingGeneration = UUID()
    recordingFinalizing = false
    /** 首帧探测期间只确认物理输入，不应把 writer 启动前的 PCM 写进 sidecar */
    acceptMicSamples = false
    acceptTapSamples = tapRequested
    micRecoveryRequested = micRequested
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
    recordingOutputLock.lock()
    micRecoveryLock.lock()
    micRecoveryWorkItem?.cancel()
    micRecoveryWorkItem = nil
    micRecoveryToken = nil
    micRecoveryRerunReason = nil
    recordingGeneration = UUID()
    recordingFinalizing = true
    acceptMicSamples = false
    acceptTapSamples = false
    micRecoveryRequested = false
    micRecoveryLock.unlock()
    recordingOutputLock.unlock()
    micCapture.invalidateGeneration()
    tapCapture.invalidateGeneration()
  }

  private func shouldAcceptTapSamples() -> Bool {
    micRecoveryLock.lock()
    defer { micRecoveryLock.unlock() }
    return acceptTapSamples
  }

  private func shouldAcceptMicSamples() -> Bool {
    micRecoveryLock.lock()
    defer { micRecoveryLock.unlock() }
    return acceptMicSamples
  }

  private func enableMicSampleGate() {
    recordingTimeline.markMicAcceptanceBoundary()
    micRecoveryLock.lock()
    acceptMicSamples = true
    micRecoveryLock.unlock()
  }

  private func disableMicSampleGate() {
    micRecoveryLock.lock()
    acceptMicSamples = false
    micRecoveryLock.unlock()
  }

  /** 登记暂停期间发生的默认输入设备变更（锁内，可从 HAL 监听队列安全调用） */
  private func markMicDeviceChangedWhilePaused() {
    micRecoveryLock.lock()
    micDeviceChangedWhilePaused = true
    micRecoveryLock.unlock()
  }

  /** 取出并清空暂停期间的设备变更记账 */
  private func consumeMicDeviceChangedWhilePaused() -> Bool {
    micRecoveryLock.lock()
    defer { micRecoveryLock.unlock() }
    let changed = micDeviceChangedWhilePaused
    micDeviceChangedWhilePaused = false
    return changed
  }

  private func setTapSampleGate(_ enabled: Bool) {
    if enabled {
      recordingTimeline.markTapAcceptanceBoundary()
    }
    micRecoveryLock.lock()
    acceptTapSamples = enabled
    micRecoveryLock.unlock()
  }

  private func isRecordingGenerationCurrent(_ generation: UUID) -> Bool {
    micRecoveryLock.lock()
    defer { micRecoveryLock.unlock() }
    return recordingGeneration == generation
  }

  private func setMicRecoveryRequested(_ requested: Bool) {
    micRecoveryLock.lock()
    micRecoveryRequested = requested
    micRecoveryLock.unlock()
  }

  private func isMicRecoveryRequested() -> Bool {
    micRecoveryLock.withLock { micRecoveryRequested }
  }

  private func isMicActive() -> Bool {
    return micCapture.isActive
  }

  /** 重挂成功 / 设备变更时清零退避,让耗尽重试次数的录音也能重新拉起 mic(锁内,可从任意队列安全调用) */
  @discardableResult
  private func resetMicRecoveryBackoff(for expectedGeneration: UUID? = nil) -> Bool {
    micRecoveryLock.lock()
    defer { micRecoveryLock.unlock() }
    guard expectedGeneration.map({ $0 == recordingGeneration }) ?? true else {
      return false
    }
    micRecoveryAttempts = 0
    micDegradedEmitted = false
    return true
  }

  /** 看门狗用:是否还能再自动重挂(未达上限)。锁内读,避免与命令链上的写撕裂 */
  private func micRecoveryCanRetry() -> Bool {
    micRecoveryLock.lock()
    defer { micRecoveryLock.unlock() }
    return micRecoveryAttempts < MIC_RECOVERY_MAX_ATTEMPTS
  }

  /** 只为当前录音代际记重挂失败，避免 stop 后的旧任务污染下一场状态 */
  private func recordMicRecoveryFailure(
    for generation: UUID
  ) -> (attempts: Int, shouldEmitDegraded: Bool)? {
    micRecoveryLock.lock()
    defer { micRecoveryLock.unlock() }
    guard recordingGeneration == generation, !recordingFinalizing else { return nil }
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

    let lastMicSampleAt = sampleQueue.sync { micLastSampleAt }
    let dropoutSec = lastMicSampleAt.map { Int(Date().timeIntervalSince($0)) }
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
    let recovered = attachMic(aec: micAecPref, generation: generation) != nil
    guard isMicRecoveryValid(token: token, generation: generation) else {
      log("tap: mic recovery result discarded (\(reason))")
      return
    }
    if recovered {
      /** attachMic 成功路径已清零 micRecoveryAttempts / micDegradedEmitted */
      log("tap: mic recovery succeeded (micCb=\(micCapture.callbackCount)), devices: \(describeDefaultAudioDevices())")
      return
    }

    guard let (attempts, shouldEmitDegraded) = recordMicRecoveryFailure(for: generation) else {
      log("tap: stale mic recovery failure discarded (\(reason))")
      return
    }
    log("tap: mic recovery failed (attempt \(attempts)/\(MIC_RECOVERY_MAX_ATTEMPTS), micCb=\(micCapture.callbackCount)), devices: \(describeDefaultAudioDevices())")

    /**
     * 连续失败达上限:停看门狗周期重试(仍留 HAL 设备变更监听待复联拉起),并发一次非致命降级诊断
     * 否则最终仍可能正常出卡 / 转写成功 / 清本地文件,产品层表现为「录音成功但后半段无人声」的静默数据损失
     */
    if shouldEmitDegraded {
      let detail = "mic capture lost, recovery failed after \(attempts) attempts, dropout=\(dropoutSec.map { "\($0)s" } ?? "?"), reason=\(reason), devices: \(describeDefaultAudioDevices())"
      log("tap: mic capture degraded — \(detail)")
      emitIfRecordingCurrent(generation: generation) {
        emitDiagnostic("mic_degraded", detail: detail)
      }
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
    /**
     * 暂停期间采样闸门关闭，requestMicRecovery 会被 acceptMicSamples 守卫挡掉，
     * 设备变更会被静默丢弃。这里先记账，由 resume 决定是否重挂
     */
    if recordingTimeline.isPaused {
      markMicDeviceChangedWhilePaused()
      log("tap: default input change deferred to resume (paused)")
      return
    }
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

  /**
   * 主 writer 只承载系统音；麦克风恒写 PCM sidecar，避开实时 AAC 在设备切换和 VPIO 时的静默失败
   * AAC 仅支持 8k~48k；tap 原生采样率跟随输出设备，罕见值与未挂 tap 的缺省均落 48k
   */
  private func setupWriter(outputPath: String) throws {
    let url = URL(fileURLWithPath: outputPath)
    try? FileManager.default.removeItem(at: url)

    let w = try AVAssetWriter(outputURL: url, fileType: .m4a)

    let tapSampleRate = tapCapture.format?.mSampleRate ?? 48000
    let sampleRate = SUPPORTED_AAC_SAMPLE_RATES.contains(tapSampleRate)
      ? tapSampleRate
      : 48000

    let systemSettings = aacSystemAudioSettings(sampleRate: sampleRate)
    let sysInput = try addAudioWriterInput(
      to: w,
      outputSettings: systemSettings,
      sourceFormatHint: tapCapture.formatDescription,
      expectsMediaDataInRealTime: true
    )
    try startAudioWriter(w)

    writer = w
    systemInput = sysInput
    checkpointWriter = AudioCheckpointWriter(
      outputPath: outputPath,
      systemSettings: systemSettings,
      systemSourceFormatHint: tapCapture.formatDescription
    )
    sessionStarted = false
  }

  /**
   * 起 mic 采集引擎（VPIO AEC 或裸采集）；PCM 由 TapMicSidecarWriter 按需建档
   *
   * 录音中热挂时:VPIO 启动会重配置输出设备,可能扰动正在跑的 tap——若实测有此问题,
   * 需改为「tap 正跑时挂 mic 强制走裸采集」或「重挂 tap」策略。返回是否成功挂上
   */
  @discardableResult
  private func attachMic(
    aec: Bool,
    generation: UUID,
    preferredStrategy: MicCaptureStrategy? = nil,
    preferredDeviceKey: String? = nil
  ) -> UUID? {
    guard isRecordingGenerationCurrent(generation), !isMicActive() else {
      return isRecordingGenerationCurrent(generation) ? micCapture.activeGenerationToken : nil
    }
    guard let physicalGeneration = micCapture.attach(
      aec: aec,
      preferredStrategy: preferredStrategy,
      preferredDeviceKey: preferredDeviceKey
    ) else { return nil }
    guard isRecordingGenerationCurrent(generation) else {
      micCapture.detach(ifCurrentGeneration: physicalGeneration)
      return nil
    }

    /** 重挂 mic 后重置 mic 轨 gap 基准:关麦超阈值再开麦时,陈旧时间戳会让下一个 tick 抢在新引擎首帧前误报掉线 */
    let accepted = sampleQueue.sync {
      guard isRecordingGenerationCurrent(generation) else { return false }
      micLastSampleAt = Date()
      return true
    }
    guard accepted,
          isRecordingGenerationCurrent(generation),
          resetMicRecoveryBackoff(for: generation)
    else {
      micCapture.detach(ifCurrentGeneration: physicalGeneration)
      return nil
    }
    return physicalGeneration
  }

  /** 停止 mic 采集引擎，已写入 sidecar 的 PCM 保留到最终混音 */
  private func detachMic() {
    guard isMicActive() else { return }
    micCapture.detach()
    /** 排空后再废弃旧设备的转换器，队列中残留写入不会与新格式交错 */
    sampleQueue.sync {
      micSidecarWriter?.invalidateInputFormat()
    }
  }

  private func appendMicSample(
    _ buffer: AVAudioPCMBuffer,
    captureHostTime: CMTime,
    processingMode: MicCaptureProcessingMode
  ) {
    guard shouldAcceptMicSamples(),
          let logicalTime = recordingTimeline.logicalMicTime(at: captureHostTime) else { return }
    if micSidecarWriter?.append(buffer, at: logicalTime, processingMode: processingMode) == true {
      micLastSampleAt = Date()
    }
  }

  /**
   * 给 sampleQueue 投递一个尾部哨兵并有界等待。等待发生在独立任务中，不占 stdin command
   * chain；超时只表示不能安全 finalize，不会尝试取消或并发访问队列内仍在执行的任务
   */
  private func drainQueue(_ queue: DispatchQueue, timeout: TimeInterval) async -> Bool {
    await withCheckedContinuation { continuation in
      let resolution = QueueDrainResolution(continuation)
      queue.async {
        resolution.resolve(true)
      }
      DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + timeout) {
        resolution.resolve(false)
      }
    }
  }

  private func appendSystemSample(_ sampleBuffer: CMSampleBuffer) -> TapProcessCapture.SampleDisposition {
    guard let writer, writer.status == .writing else { return .ignored }

    /** 统一到录音逻辑时间；记录有效片段，暂停时段从两轨共同剔除 */
    guard let adjusted = recordingTimeline.retimeSystemSample(sampleBuffer) else { return .ignored }

    if !sessionStarted {
      /** AAC 会压紧 PTS 空洞；session 从零开始，最终由片段映射恢复真实位置 */
      writer.startSession(atSourceTime: .zero)
      sessionStarted = true
    }

    if let systemInput, systemInput.isReadyForMoreMediaData {
      let appended = systemInput.append(adjusted)
      if !appended {
        log("append failed (system): \(writer.error?.localizedDescription ?? "unknown")")
        return .ignored
      }
      checkpointWriter?.append(adjusted, track: .system)
      recordingTimeline.recordSystemSample(adjusted)
      sysLastSampleAt = Date()
      return .appended
    }

    return .dropped
  }

  // ── 拆除与清理 ──

  private func stopCapturePipeline() {
    tapCapture.teardown()
    detachMic()
  }

  private func cleanup(preservePhysicalCapture: Bool = false) {
    if !preservePhysicalCapture {
      stopCapturePipeline()
    }
    /** preserve 时 lifecycle owner 仍可能在 Core Audio 内；不再触碰其状态，物理资源随 helper 回收 */
    writer = nil
    checkpointWriter = nil
    systemInput = nil
    micSidecarWriter?.finish()
    micSidecarWriter = nil
    micAecPref = true
    startTime = nil
    totalPausedDuration = 0
    pausedAt = nil
    recordingTimeline.reset()
    sessionStarted = false
    firstSampleWatchdogToken = UUID()
    firstSampleErrorEmitted = false
    sampleGapWatchdogToken = UUID()
    sampleGapErrorEmitted = false
    sysLastSampleAt = nil
    micLastSampleAt = nil
    unregisterDefaultInputDeviceListener()
    micRequested = false
    tapRequested = false
    resetMicRecoveryBackoff()
    if !preservePhysicalCapture {
      cancelMicRecoveryForStop()
    }
    if !preservePhysicalCapture {
      tapCapture.resetSessionState()
    }
  }
}

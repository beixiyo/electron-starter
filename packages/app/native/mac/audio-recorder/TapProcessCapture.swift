// 封装 Core Audio process tap、聚合设备、IOProc 与系统音样本归一

import AVFoundation
import CoreAudio
import CoreMedia
import Foundation

/**
 * Core Audio process tap 的物理资源所有者
 *
 * 负责把 PID 过滤规则转换成 CATapDescription，创建 process tap、聚合设备和 IOProc，
 * 再把 tap PCM 归一成 CMSampleBuffer 交给上层。writer、checkpoint、暂停时间轴和混音策略
 * 仍由 TapRecorder 决定
 */
@available(macOS 14.2, *)
final class TapProcessCapture {
  enum SampleDisposition {
    case appended
    case dropped
    case ignored
  }

  struct Statistics {
    let callbackCount: Int
    let appendCount: Int
    let dropCount: Int
  }

  private let sampleQueue: DispatchQueue
  private let shouldAcceptSamples: () -> Bool
  private let consumeSample: (CMSampleBuffer) -> SampleDisposition
  private let stateLock = NSLock()

  private var tapID = AudioObjectID(kAudioObjectUnknown)
  private var aggregateID = AudioObjectID(kAudioObjectUnknown)
  private var deviceProcID: AudioDeviceIOProcID?

  private(set) var format: AudioStreamBasicDescription?
  private(set) var formatDescription: CMAudioFormatDescription?
  private var active = false
  private var activeGeneration: UUID?

  private var callbackCount = 0
  private var appendCount = 0
  private var dropCount = 0
  private var receivedNonSilentBuffer = false
  private var silentBufferCount = 0
  private var ambiguousBufferLayoutLogged = false

  init(
    sampleQueue: DispatchQueue,
    shouldAcceptSamples: @escaping () -> Bool,
    consumeSample: @escaping (CMSampleBuffer) -> SampleDisposition
  ) {
    self.sampleQueue = sampleQueue
    self.shouldAcceptSamples = shouldAcceptSamples
    self.consumeSample = consumeSample
  }

  var statistics: Statistics {
    Statistics(
      callbackCount: callbackCount,
      appendCount: appendCount,
      dropCount: dropCount
    )
  }

  /** IOProc 在 sampleQueue 运行，物理管线由 lifecycle queue 启停，跨队列读取必须取快照 */
  var isActive: Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    return active
  }

  /**
   * pids 非空时只捕获指定进程；pids 为空时捕获全系统并排除 excludePids
   *
   * 从未向 Core Audio 注册的进程无法翻译为 AudioObjectID：include 模式全部失败时拒绝，
   * exclude 模式则跳过，因为未出声的进程本来也无需排除
   */
  func makeDescription(pids: [pid_t], excludePids: [pid_t]) throws -> CATapDescription {
    let description: CATapDescription

    if pids.isEmpty {
      let excludedObjects = excludePids.compactMap(translatePIDToAudioObject)
      description = CATapDescription(stereoGlobalTapButExcludeProcesses: excludedObjects)
    }
    else {
      let includedObjects = pids.compactMap(translatePIDToAudioObject)
      guard !includedObjects.isEmpty else {
        throw TapRecorderError("tap_no_capturable_process")
      }
      if includedObjects.count < pids.count {
        log("tap: \(pids.count - includedObjects.count) pid(s) not registered with CoreAudio, skipped")
      }
      description = CATapDescription(stereoMixdownOfProcesses: includedObjects)
    }

    description.uuid = UUID()
    description.muteBehavior = .unmuted
    return description
  }

  /** 创建 process tap、读取其格式并建立私有聚合设备，IOProc 由 start() 单独启动 */
  func prepare(_ description: CATapDescription) throws {
    guard tapID == AudioObjectID(kAudioObjectUnknown),
          aggregateID == AudioObjectID(kAudioObjectUnknown),
          deviceProcID == nil
    else {
      throw TapRecorderError("tap_pipeline_already_prepared")
    }

    var newTapID = AudioObjectID(kAudioObjectUnknown)
    let tapError = AudioHardwareCreateProcessTap(description, &newTapID)
    guard tapError == noErr, newTapID != AudioObjectID(kAudioObjectUnknown) else {
      throw TapRecorderError("tap_create_failed_\(tapError)")
    }
    tapID = newTapID

    var newFormat = try readTapFormat(newTapID)
    if let previous = format,
       previous.mSampleRate != newFormat.mSampleRate
        || previous.mChannelsPerFrame != newFormat.mChannelsPerFrame {
      log("tap format changed: \(previous.mSampleRate)Hz/\(previous.mChannelsPerFrame)ch → \(newFormat.mSampleRate)Hz/\(newFormat.mChannelsPerFrame)ch")
    }

    var newFormatDescription: CMAudioFormatDescription?
    let formatError = CMAudioFormatDescriptionCreate(
      allocator: kCFAllocatorDefault,
      asbd: &newFormat,
      layoutSize: 0,
      layout: nil,
      magicCookieSize: 0,
      magicCookie: nil,
      extensions: nil,
      formatDescriptionOut: &newFormatDescription
    )
    guard formatError == noErr, let newFormatDescription else {
      throw TapRecorderError("tap_format_description_failed_\(formatError)")
    }

    format = newFormat
    formatDescription = newFormatDescription
    try createAggregateDevice(tapUUID: description.uuid)
  }

  /** 在 prepare() 创建的聚合设备上安装并启动 IOProc */
  func start() throws {
    guard aggregateID != AudioObjectID(kAudioObjectUnknown) else {
      throw TapRecorderError("tap_pipeline_not_prepared")
    }
    guard deviceProcID == nil else {
      throw TapRecorderError("tap_ioproc_already_started")
    }

    let generation = UUID()
    stateLock.withLock {
      activeGeneration = generation
      active = false
    }

    var error = AudioDeviceCreateIOProcIDWithBlock(
      &deviceProcID,
      aggregateID,
      sampleQueue
    ) { [weak self] _, inputData, inputTime, _, _ in
      self?.handleBuffer(inputData, inputTime, generation: generation)
    }
    guard error == noErr, deviceProcID != nil else {
      invalidateGeneration()
      throw TapRecorderError("tap_ioproc_failed_\(error)")
    }

    error = AudioDeviceStart(aggregateID, deviceProcID)
    guard error == noErr else {
      if let deviceProcID {
        AudioDeviceDestroyIOProcID(aggregateID, deviceProcID)
        self.deviceProcID = nil
      }
      invalidateGeneration()
      throw TapRecorderError("tap_start_failed_\(error)")
    }
    stateLock.withLock {
      if activeGeneration == generation {
        active = true
      }
    }
  }

  /** 按固定顺序幂等拆除 IOProc、聚合设备和 process tap */
  func teardown() {
    /** 先让已排队的旧 callback 失效，再停止和销毁物理资源 */
    invalidateGeneration()
    if aggregateID != AudioObjectID(kAudioObjectUnknown) {
      if let deviceProcID {
        AudioDeviceStop(aggregateID, deviceProcID)
        /** IOBlock 同步 dispatch 到 sampleQueue；先排空迟到 callback 再销毁其引用的 IOProc */
        sampleQueue.sync {}
        AudioDeviceDestroyIOProcID(aggregateID, deviceProcID)
      }
      AudioHardwareDestroyAggregateDevice(aggregateID)
    }
    if tapID != AudioObjectID(kAudioObjectUnknown) {
      AudioHardwareDestroyProcessTap(tapID)
    }

    self.deviceProcID = nil
    aggregateID = AudioObjectID(kAudioObjectUnknown)
    tapID = AudioObjectID(kAudioObjectUnknown)
  }

  /** 清空会话格式与诊断统计，不触碰正在等待 helper 回收的物理资源 */
  func resetSessionState() {
    format = nil
    formatDescription = nil
    callbackCount = 0
    appendCount = 0
    dropCount = 0
    receivedNonSilentBuffer = false
    silentBufferCount = 0
    ambiguousBufferLayoutLogged = false
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
    let error = AudioObjectGetPropertyData(
      AudioObjectID(kAudioObjectSystemObject),
      &address,
      UInt32(MemoryLayout<pid_t>.size),
      &qualifierPID,
      &dataSize,
      &objectID
    )
    guard error == noErr, objectID != AudioObjectID(kAudioObjectUnknown) else {
      return nil
    }
    return objectID
  }

  /** terminal stop 不拆物理管线，只让已排队和后续 callback 失效 */
  func invalidateGeneration() {
    stateLock.withLock {
      activeGeneration = nil
      active = false
    }
  }

  private func isCurrentGeneration(_ generation: UUID) -> Bool {
    stateLock.withLock { activeGeneration == generation }
  }

  private func readTapFormat(_ tapID: AudioObjectID) throws -> AudioStreamBasicDescription {
    var address = AudioObjectPropertyAddress(
      mSelector: kAudioTapPropertyFormat,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    var format = AudioStreamBasicDescription()
    var dataSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    let error = AudioObjectGetPropertyData(tapID, &address, 0, nil, &dataSize, &format)
    guard error == noErr else {
      throw TapRecorderError("tap_format_read_failed_\(error)")
    }
    return format
  }

  /** 默认系统输出是聚合设备主 sub-device，process tap 通过 TapList 挂入并启用漂移补偿 */
  private func createAggregateDevice(tapUUID: UUID) throws {
    let outputUID = try readDefaultOutputDeviceUID()
    let description: [String: Any] = [
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
    let error = AudioHardwareCreateAggregateDevice(description as CFDictionary, &newAggregateID)
    guard error == noErr, newAggregateID != AudioObjectID(kAudioObjectUnknown) else {
      throw TapRecorderError("tap_aggregate_failed_\(error)")
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
    var error = AudioObjectGetPropertyData(
      AudioObjectID(kAudioObjectSystemObject),
      &address,
      0,
      nil,
      &dataSize,
      &deviceID
    )
    guard error == noErr, deviceID != AudioObjectID(kAudioObjectUnknown) else {
      throw TapRecorderError("tap_default_output_failed_\(error)")
    }

    var uidAddress = AudioObjectPropertyAddress(
      mSelector: kAudioDevicePropertyDeviceUID,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    var uid: CFString = "" as CFString
    var uidSize = UInt32(MemoryLayout<CFString>.size)
    error = withUnsafeMutablePointer(to: &uid) { pointer in
      AudioObjectGetPropertyData(deviceID, &uidAddress, 0, nil, &uidSize, pointer)
    }
    guard error == noErr else {
      throw TapRecorderError("tap_device_uid_failed_\(error)")
    }
    return uid as String
  }

  /**
   * 聚合设备 ABL 中可能含 VPIO 参考流，先排除声道数不同的流
   *
   * Core Audio 没有在 callback 里附带 buffer 来源；若外部虚拟设备也暴露同声道流，
   * 当前无法只凭 ABL 证明哪个是 tap，因此记录完整布局供真机定位
   */
  private func handleBuffer(
    _ bufferList: UnsafePointer<AudioBufferList>,
    _ inputTime: UnsafePointer<AudioTimeStamp>,
    generation: UUID
  ) {
    guard isCurrentGeneration(generation) else { return }
    callbackCount += 1
    guard shouldAcceptSamples(),
          let format,
          let formatDescription
    else { return }

    let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: bufferList))
    let matchingBuffers = buffers.filter { $0.mNumberChannels == format.mChannelsPerFrame }
    guard let tapBuffer = matchingBuffers.first else {
      if dropCount == 0 {
        let layout = buffers
          .map { "\($0.mNumberChannels)ch/\($0.mDataByteSize)B" }
          .joined(separator: ",")
        log("tap: no stream matches tap format \(format.mChannelsPerFrame)ch, abl=[\(layout)]")
      }
      dropCount += 1
      return
    }
    if matchingBuffers.count > 1, !ambiguousBufferLayoutLogged {
      let layout = buffers
        .map { "\($0.mNumberChannels)ch/\($0.mDataByteSize)B" }
        .joined(separator: ",")
      log("tap: ambiguous ABL has \(matchingBuffers.count) streams matching \(format.mChannelsPerFrame)ch; using first, abl=[\(layout)]")
      ambiguousBufferLayoutLogged = true
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
      if dropCount == 0 { log("tap: CMSampleBufferCreate failed \(status)") }
      dropCount += 1
      return
    }

    var tapOnlyList = AudioBufferList(mNumberBuffers: 1, mBuffers: tapBuffer)
    status = CMSampleBufferSetDataBufferFromAudioBufferList(
      sampleBuffer,
      blockBufferAllocator: kCFAllocatorDefault,
      blockBufferMemoryAllocator: kCFAllocatorDefault,
      flags: 0,
      bufferList: &tapOnlyList
    )
    guard status == noErr else {
      if dropCount == 0 { log("tap: SetDataBufferFromAudioBufferList failed \(status)") }
      dropCount += 1
      return
    }

    switch consumeSample(sampleBuffer) {
    case .appended:
      appendCount += 1
    case .dropped:
      dropCount += 1
    case .ignored:
      break
    }
  }

  private func trackSilence(_ buffer: AudioBuffer, format: AudioStreamBasicDescription) {
    guard !receivedNonSilentBuffer,
          format.mFormatFlags & kAudioFormatFlagIsFloat != 0,
          let data = buffer.mData
    else { return }

    let floats = data.assumingMemoryBound(to: Float32.self)
    let sampleCount = min(64, Int(buffer.mDataByteSize) / MemoryLayout<Float32>.size)
    for index in 0..<sampleCount where abs(floats[index]) > 1e-6 {
      receivedNonSilentBuffer = true
      return
    }

    silentBufferCount += 1
    if silentBufferCount == 1000 {
      log("tap: 1000 consecutive silent buffers - check System Audio Recording permission or source app volume")
    }
  }
}

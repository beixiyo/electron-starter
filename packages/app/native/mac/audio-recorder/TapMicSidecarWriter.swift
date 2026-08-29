// 统一麦克风 PCM 格式、电平处理和 `.mic.caf` sidecar 写盘

import AVFoundation
import AudioProcessing
import CoreMedia
import Darwin

/**
 * 麦克风 PCM sidecar 的唯一状态所有者
 *
 * 输入是 MicCapture 交付的 PCM，输出是与主 M4A 同名的 `.mic.caf`；
 * 内部负责文件格式冻结、设备切换后的格式转换、受限人声增益与写盘诊断
 * 该对象由 TapRecorder.sampleQueue 独占，读取 summary 前必须先排空该队列
 */
final class TapMicSidecarWriter {
  private enum TimelinePolicy {
    /** 忽略 callback 调度拖延，只对热挂、掉线等可见断层补静音 */
    static let minimumGapSeconds = 0.1
    /** 长时间后热挂 mic 时分块写零，避免一次分配过大 buffer */
    static let maximumSilenceChunkSeconds = 10.0
  }

  let fileURL: URL

  private let signalProcessor = MicrophoneSignalProcessor(
    logger: { message in log(message) },
    onInputRMS: { rms in AudioLevelMeter.shared.submit(inputRMS: rms) }
  )
  private var audioFile: AVAudioFile?
  private var converter: AVAudioConverter?
  private var converterSourceFormat: AVAudioFormat?
  private var sampleFormatLogged = false
  private var formatConversionLogged = false

  private(set) var appendCount = 0
  private(set) var dropCount = 0
  private(set) var writeError: Error?
  var hasDetectedSignal: Bool { signalProcessor.hasObservedSignal }

  init(outputPath: String) {
    let outputURL = URL(fileURLWithPath: outputPath)
    fileURL = outputURL.deletingLastPathComponent()
      .appendingPathComponent("\(outputURL.deletingPathExtension().lastPathComponent).mic.caf")
    try? FileManager.default.removeItem(at: fileURL)
  }

  @discardableResult
  func append(
    _ buffer: AVAudioPCMBuffer,
    at logicalTime: CMTime
  ) -> Bool {
    do {
      if audioFile == nil {
        guard let sidecarFormat = AVAudioFormat(
          commonFormat: .pcmFormatFloat32,
          sampleRate: buffer.format.sampleRate,
          channels: buffer.format.channelCount,
          interleaved: false
        ) else {
          dropCount += 1
          if dropCount == 1 {
            log("tap: mic sidecar Float32 format unavailable")
          }
          return false
        }
        audioFile = try AVAudioFile(
          forWriting: fileURL,
          settings: sidecarFormat.settings,
          commonFormat: sidecarFormat.commonFormat,
          interleaved: sidecarFormat.isInterleaved
        )
        log("tap: mic sidecar started \(fileURL.path)")
      }

      guard let audioFile else { return false }
      logSampleFormatIfNeeded(buffer)
      guard let writableBuffer = bufferForWrite(buffer, targetFormat: audioFile.processingFormat) else {
        dropCount += 1
        return false
      }

      try appendTimelineSilenceIfNeeded(
        before: writableBuffer,
        logicalTime: logicalTime,
        audioFile: audioFile
      )
      signalProcessor.process(writableBuffer)
      try audioFile.write(from: writableBuffer)
      appendCount += 1
      return true
    }
    catch {
      dropCount += 1
      if isStorageInsufficientError(error), writeError == nil {
        writeError = error
        log("tap: mic sidecar storage insufficient: \(describeError(error))")
      }
      if dropCount == 1 {
        log("tap: mic sidecar write failed: \(describeError(error))")
      }
      return false
    }
  }

  /** 关闭 CAF，使其头部和帧数在读取时可见 */
  func finish() {
    audioFile = nil
    converter = nil
    converterSourceFormat = nil
  }

  /** 输入设备换代后废弃旧格式转换器，CAF 的目标格式保持不变 */
  func invalidateInputFormat() {
    converter = nil
    converterSourceFormat = nil
  }

  private func logSampleFormatIfNeeded(_ buffer: AVAudioPCMBuffer) {
    guard !sampleFormatLogged else { return }

    let duration = CMTime(
      value: CMTimeValue(buffer.frameLength),
      timescale: CMTimeScale(max(1, Int32(buffer.format.sampleRate.rounded())))
    )
    log(
      "tap: mic sidecar format rate=\(Int(buffer.format.sampleRate))Hz "
        + "channels=\(buffer.format.channelCount) commonFormat=\(buffer.format.commonFormat.rawValue) "
        + "interleaved=\(buffer.format.isInterleaved) frameLength=\(buffer.frameLength) "
        + "bufferDuration=\(formatCMTimeSeconds(duration))"
    )
    sampleFormatLogged = true
  }

  /** 按录音逻辑时间补齐首次热挂或掉线重连的空洞，暂停时长已由上层扣除 */
  private func appendTimelineSilenceIfNeeded(
    before buffer: AVAudioPCMBuffer,
    logicalTime: CMTime,
    audioFile: AVAudioFile
  ) throws {
    let logicalSeconds = logicalTime.seconds
    guard logicalTime.isNumeric, logicalSeconds.isFinite, logicalSeconds >= 0 else { return }

    let sampleRate = audioFile.processingFormat.sampleRate
    let desiredStartFrame = AVAudioFramePosition((logicalSeconds * sampleRate).rounded())
    let missingFrames = desiredStartFrame - audioFile.length
    /** callback host time 接近当前 buffer 的交付时刻，容忍一个 buffer 本身的时长 */
    let toleranceFrames = max(
      AVAudioFramePosition(buffer.frameLength),
      AVAudioFramePosition((sampleRate * TimelinePolicy.minimumGapSeconds).rounded())
    )
    guard missingFrames > toleranceFrames else { return }

    try appendSilence(frameCount: missingFrames, audioFile: audioFile)
    log(
      "tap: mic sidecar inserted \(String(format: "%.3f", Double(missingFrames) / sampleRate))s "
        + "silence at logical \(String(format: "%.3f", logicalSeconds))s"
    )
  }

  private func appendSilence(frameCount: AVAudioFramePosition, audioFile: AVAudioFile) throws {
    let sampleRate = audioFile.processingFormat.sampleRate
    let maximumChunkFrames = max(
      1,
      AVAudioFramePosition((sampleRate * TimelinePolicy.maximumSilenceChunkSeconds).rounded())
    )
    let capacity = AVAudioFrameCount(min(frameCount, maximumChunkFrames))
    guard let silence = AVAudioPCMBuffer(
      pcmFormat: audioFile.processingFormat,
      frameCapacity: capacity
    ) else {
      throw TapRecorderError("mic_sidecar_silence_allocation_failed")
    }

    var remaining = frameCount
    while remaining > 0 {
      silence.frameLength = AVAudioFrameCount(min(remaining, AVAudioFramePosition(capacity)))
      for audioBuffer in UnsafeMutableAudioBufferListPointer(silence.mutableAudioBufferList) {
        if let data = audioBuffer.mData {
          memset(data, 0, Int(audioBuffer.mDataByteSize))
        }
      }
      try audioFile.write(from: silence)
      remaining -= AVAudioFramePosition(silence.frameLength)
    }
  }

  private func bufferForWrite(
    _ buffer: AVAudioPCMBuffer,
    targetFormat: AVAudioFormat
  ) -> AVAudioPCMBuffer? {
    guard !isSameAudioFormat(buffer.format, targetFormat) else { return buffer }

    if !formatConversionLogged {
      log(
        "tap: mic sidecar converting format source=\(describeAudioFormat(buffer.format)) "
          + "target=\(describeAudioFormat(targetFormat))"
      )
      formatConversionLogged = true
    }

    if converter == nil
      || converterSourceFormat.map({ !isSameAudioFormat($0, buffer.format) }) ?? true {
      converter = AVAudioConverter(from: buffer.format, to: targetFormat)
      converterSourceFormat = buffer.format
    }
    guard let converter else {
      if dropCount == 0 {
        log(
          "tap: mic sidecar converter unavailable source=\(describeAudioFormat(buffer.format)) "
            + "target=\(describeAudioFormat(targetFormat))"
        )
      }
      return nil
    }

    let sampleRateRatio = targetFormat.sampleRate / max(1, buffer.format.sampleRate)
    let frameCapacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * sampleRateRatio)) + 16
    guard let converted = AVAudioPCMBuffer(
      pcmFormat: targetFormat,
      frameCapacity: max(1, frameCapacity)
    ) else {
      if dropCount == 0 {
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
      if dropCount == 0 {
        log(
          "tap: mic sidecar conversion failed status=\(status.rawValue) "
            + "error=\(describeError(conversionError))"
        )
      }
      return nil
    }

    return converted
  }
}

func isSameAudioFormat(_ lhs: AVAudioFormat, _ rhs: AVAudioFormat) -> Bool {
  abs(lhs.sampleRate - rhs.sampleRate) < 0.5
    && lhs.channelCount == rhs.channelCount
    && lhs.commonFormat == rhs.commonFormat
    && lhs.isInterleaved == rhs.isInterleaved
}

func describeAudioFormat(_ format: AVAudioFormat) -> String {
  let asbd = format.streamDescription.pointee
  return "\(Int(format.sampleRate))Hz/\(format.channelCount)ch "
    + "common=\(format.commonFormat.rawValue) interleaved=\(format.isInterleaved) "
    + "format=\(asbd.mFormatID) flags=\(asbd.mFormatFlags) "
    + "bytesPerFrame=\(asbd.mBytesPerFrame) bits=\(asbd.mBitsPerChannel)"
}

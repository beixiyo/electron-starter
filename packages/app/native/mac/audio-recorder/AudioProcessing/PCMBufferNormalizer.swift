// 把采集到的任意 PCM 归一为 48 kHz、单声道、非交错 Float32

import AVFoundation
import CoreMedia
import Darwin

public enum PCMNormalizationError: Error, CustomStringConvertible, Equatable {
  case invalidFormat(String)
  case conversion(String)

  public var description: String {
    switch self {
    case .invalidFormat(let detail): "PCM format error: \(detail)"
    case .conversion(let detail): "PCM conversion error: \(detail)"
    }
  }
}

public final class PCMBufferNormalizer: @unchecked Sendable {
  public let outputFormat: AVAudioFormat

  private let downmixMode: AudioDownmixMode
  private var inputConverter: AVAudioConverter?
  private var inputConverterFormat: AVAudioFormat?
  private var resampler: AVAudioConverter?
  private var resamplerRate: Double?

  public init(downmixMode: AudioDownmixMode = .average) throws {
    guard let outputFormat = AVAudioFormat(
      commonFormat: .pcmFormatFloat32,
      sampleRate: Double(AUDIO_PROCESSING_SAMPLE_RATE),
      channels: 1,
      interleaved: false
    ) else {
      throw PCMNormalizationError.invalidFormat("cannot create 48 kHz mono format")
    }
    self.outputFormat = outputFormat
    self.downmixMode = downmixMode
  }

  public func normalize(_ buffer: AVAudioPCMBuffer) throws -> AVAudioPCMBuffer {
    guard buffer.frameLength > 0, buffer.format.sampleRate > 0, buffer.format.channelCount > 0 else {
      throw PCMNormalizationError.invalidFormat("empty or invalid input format")
    }
    let floatBuffer = try floatNonInterleavedBuffer(buffer)
    let monoBuffer = try downmix(floatBuffer)
    guard abs(monoBuffer.format.sampleRate - outputFormat.sampleRate) >= 0.5 else {
      return monoBuffer
    }
    return try resample(monoBuffer)
  }

  /** 输入设备或路由换代后丢弃旧格式转换器，避免跨设备复用转换状态。 */
  public func resetInputFormat() {
    inputConverter = nil
    inputConverterFormat = nil
    resampler = nil
    resamplerRate = nil
  }

  public static func copy(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    guard buffer.frameLength > 0,
          let copied = AVAudioPCMBuffer(
            pcmFormat: buffer.format,
            frameCapacity: buffer.frameLength
          ) else { return nil }
    copied.frameLength = buffer.frameLength

    let sourceBuffers = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
    let targetBuffers = UnsafeMutableAudioBufferListPointer(copied.mutableAudioBufferList)
    guard sourceBuffers.count == targetBuffers.count else { return nil }
    for index in sourceBuffers.indices {
      guard let source = sourceBuffers[index].mData,
            let target = targetBuffers[index].mData else { return nil }
      let byteCount = Int(min(
        sourceBuffers[index].mDataByteSize,
        targetBuffers[index].mDataByteSize
      ))
      memcpy(target, source, byteCount)
      targetBuffers[index].mDataByteSize = UInt32(byteCount)
    }
    return copied
  }

  public static func copy(_ sampleBuffer: CMSampleBuffer) -> AVAudioPCMBuffer? {
    guard CMSampleBufferDataIsReady(sampleBuffer),
          let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
          let streamDescription = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription),
          let format = AVAudioFormat(streamDescription: streamDescription)
    else { return nil }

    let frameCount = CMSampleBufferGetNumSamples(sampleBuffer)
    guard frameCount > 0,
          frameCount <= Int(Int32.max),
          let copied = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: AVAudioFrameCount(frameCount)
          ) else { return nil }
    copied.frameLength = AVAudioFrameCount(frameCount)
    let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
      sampleBuffer,
      at: 0,
      frameCount: Int32(frameCount),
      into: copied.mutableAudioBufferList
    )
    return status == noErr ? copied : nil
  }

  private func floatNonInterleavedBuffer(_ buffer: AVAudioPCMBuffer) throws -> AVAudioPCMBuffer {
    if buffer.format.commonFormat == .pcmFormatFloat32,
       !buffer.format.isInterleaved,
       let copied = Self.copy(buffer) {
      return copied
    }

    guard let format = AVAudioFormat(
      commonFormat: .pcmFormatFloat32,
      sampleRate: buffer.format.sampleRate,
      channels: buffer.format.channelCount,
      interleaved: false
    ) else {
      throw PCMNormalizationError.invalidFormat("cannot create Float32 source format")
    }

    if inputConverter == nil
      || inputConverterFormat.map({ !sameFormat($0, buffer.format) }) ?? true {
      inputConverter = AVAudioConverter(from: buffer.format, to: format)
      inputConverterFormat = buffer.format
    }
    guard let inputConverter else {
      throw PCMNormalizationError.conversion("cannot create input PCM converter")
    }
    return try convert(buffer, using: inputConverter, targetFormat: format)
  }

  private func downmix(_ buffer: AVAudioPCMBuffer) throws -> AVAudioPCMBuffer {
    guard let source = buffer.floatChannelData,
          let monoFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: buffer.format.sampleRate,
            channels: 1,
            interleaved: false
          ),
          let mono = AVAudioPCMBuffer(pcmFormat: monoFormat, frameCapacity: buffer.frameLength),
          let target = mono.floatChannelData?[0] else {
      throw PCMNormalizationError.conversion("cannot allocate mono buffer")
    }
    mono.frameLength = buffer.frameLength
    let frames = Int(buffer.frameLength)
    let channels = Int(buffer.format.channelCount)
    guard channels > 0 else {
      throw PCMNormalizationError.invalidFormat("source channel count is zero")
    }

    switch downmixMode {
    case .first:
      target.update(from: source[0], count: frames)
    case .average:
      for frame in 0..<frames {
        var sum: Float = 0
        for channel in 0..<channels {
          sum += source[channel][frame].isFinite ? source[channel][frame] : 0
        }
        target[frame] = sum / Float(channels)
      }
    }
    return mono
  }

  private func resample(_ buffer: AVAudioPCMBuffer) throws -> AVAudioPCMBuffer {
    if resampler == nil || resamplerRate.map({ abs($0 - buffer.format.sampleRate) >= 0.5 }) ?? true {
      resampler = AVAudioConverter(from: buffer.format, to: outputFormat)
      resamplerRate = buffer.format.sampleRate
    }
    guard let resampler else {
      throw PCMNormalizationError.conversion("cannot create sample-rate converter")
    }
    return try convert(buffer, using: resampler, targetFormat: outputFormat)
  }

  private func convert(
    _ input: AVAudioPCMBuffer,
    using converter: AVAudioConverter,
    targetFormat: AVAudioFormat
  ) throws -> AVAudioPCMBuffer {
    let ratio = targetFormat.sampleRate / max(1, input.format.sampleRate)
    let capacity = max(1, AVAudioFrameCount(ceil(Double(input.frameLength) * ratio)) + 32)
    guard let output = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else {
      throw PCMNormalizationError.conversion("cannot allocate converted buffer")
    }

    var suppliedInput = false
    var conversionError: NSError?
    let status = converter.convert(to: output, error: &conversionError) { _, inputStatus in
      guard !suppliedInput else {
        inputStatus.pointee = .noDataNow
        return nil
      }
      suppliedInput = true
      inputStatus.pointee = .haveData
      return input
    }
    guard status != .error, conversionError == nil, output.frameLength > 0 else {
      throw PCMNormalizationError.conversion(
        "converter status=\(status.rawValue) error=\(String(describing: conversionError))"
      )
    }
    return output
  }
}

private func sameFormat(_ lhs: AVAudioFormat, _ rhs: AVAudioFormat) -> Bool {
  abs(lhs.sampleRate - rhs.sampleRate) < 0.5
    && lhs.channelCount == rhs.channelCount
    && lhs.commonFormat == rhs.commonFormat
    && lhs.isInterleaved == rhs.isInterleaved
}

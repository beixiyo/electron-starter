// 为离线多轨混音提供跨 buffer 的 linked-channel sample-peak 限幅

import AVFoundation
import CoreAudio
import CoreMedia
import Foundation

/**
 * 对离线混音得到的 Float32 LPCM 做最小必要的峰值保护
 *
 * 该对象只在多轨 render 路径使用。它不修改 reader 返回的 sample buffer，
 * 而是先复制到自有 AVAudioPCMBuffer，处理后再创建独立 CMSampleBuffer。
 * gain 在多个 sample buffer 之间保留，避免 reader 分块边界产生突变。
 */
final class AudioPeakLimiter {
  private let sampleRate: Double
  private let channelCount: Int
  private let ceiling: Float
  private let releaseCoefficient: Float
  private var gain: Float = 1

  init(
    sampleRate: Double,
    channelCount: Int,
    ceiling: Float = AUDIO_LIMITER_CEILING,
    releaseSeconds: Double = AUDIO_LIMITER_RELEASE_SECONDS
  ) throws {
    guard sampleRate.isFinite, sampleRate > 0 else {
      throw AudioPeakLimiterError.invalidConfiguration("sample rate")
    }
    guard channelCount > 0 else {
      throw AudioPeakLimiterError.invalidConfiguration("channel count")
    }
    guard ceiling.isFinite, ceiling > 0, ceiling <= 1 else {
      throw AudioPeakLimiterError.invalidConfiguration("ceiling")
    }
    guard releaseSeconds.isFinite, releaseSeconds > 0 else {
      throw AudioPeakLimiterError.invalidConfiguration("release seconds")
    }

    self.sampleRate = sampleRate
    self.channelCount = channelCount
    self.ceiling = ceiling
    releaseCoefficient = Float(1 - exp(-1 / (sampleRate * releaseSeconds)))
  }

  /** 复制、限幅并重建一个保留原始 timing 的独立 sample buffer */
  func process(_ sampleBuffer: CMSampleBuffer) throws -> CMSampleBuffer {
    let sampleCount = CMSampleBufferGetNumSamples(sampleBuffer)
    guard sampleCount > 0, sampleCount <= Int(Int32.max) else {
      throw AudioPeakLimiterError.invalidTiming("sample count")
    }
    guard CMSampleBufferDataIsReady(sampleBuffer) else {
      throw AudioPeakLimiterError.invalidTiming("data is not ready")
    }

    guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
          let streamDescription = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription)
    else {
      throw AudioPeakLimiterError.invalidFormat("missing stream description")
    }

    let asbd = streamDescription.pointee
    try validate(asbd)
    let timing = try sampleTiming(of: sampleBuffer)

    guard let format = AVAudioFormat(streamDescription: streamDescription),
          let pcmBuffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: AVAudioFrameCount(sampleCount)
          )
    else {
      throw AudioPeakLimiterError.invalidFormat("cannot create Float32 PCM buffer")
    }
    pcmBuffer.frameLength = AVAudioFrameCount(sampleCount)

    let copyStatus = CMSampleBufferCopyPCMDataIntoAudioBufferList(
      sampleBuffer,
      at: 0,
      frameCount: Int32(sampleCount),
      into: pcmBuffer.mutableAudioBufferList
    )
    guard copyStatus == noErr else {
      throw AudioPeakLimiterError.copyFailed(copyStatus)
    }

    try limit(pcmBuffer, asbd: asbd, frameCount: sampleCount)
    return try makeSampleBuffer(
      pcmBuffer: pcmBuffer,
      formatDescription: formatDescription,
      timing: timing
    )
  }

  private func validate(_ asbd: AudioStreamBasicDescription) throws {
    let flags = asbd.mFormatFlags
    let requiredFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked
    guard asbd.mFormatID == kAudioFormatLinearPCM,
          flags & requiredFlags == requiredFlags,
          asbd.mBitsPerChannel == 32,
          asbd.mFramesPerPacket == 1,
          asbd.mChannelsPerFrame == channelCount,
          asbd.mSampleRate.isFinite,
          abs(asbd.mSampleRate - sampleRate) < 0.5
    else {
      throw AudioPeakLimiterError.invalidFormat(
        "expected Float32 LPCM \(Int(sampleRate))Hz/\(channelCount)ch, got \(describe(asbd))"
      )
    }

    let isNonInterleaved = flags & kAudioFormatFlagIsNonInterleaved != 0
    let expectedBytesPerFrame = isNonInterleaved ? 4 : channelCount * 4
    guard asbd.mBytesPerFrame == expectedBytesPerFrame,
          asbd.mBytesPerPacket == expectedBytesPerFrame
    else {
      throw AudioPeakLimiterError.invalidFormat("invalid Float32 LPCM frame layout")
    }
  }

  private func sampleTiming(of sampleBuffer: CMSampleBuffer) throws -> [CMSampleTimingInfo] {
    var needed: CMItemCount = 0
    var status = CMSampleBufferGetSampleTimingInfoArray(
      sampleBuffer,
      entryCount: 0,
      arrayToFill: nil,
      entriesNeededOut: &needed
    )
    guard status == noErr, needed > 0, needed <= CMItemCount(CMSampleBufferGetNumSamples(sampleBuffer)) else {
      throw AudioPeakLimiterError.invalidTiming("missing sample timing")
    }

    var timing = [CMSampleTimingInfo](
      repeating: CMSampleTimingInfo(
        duration: .invalid,
        presentationTimeStamp: .invalid,
        decodeTimeStamp: .invalid
      ),
      count: Int(needed)
    )
    status = timing.withUnsafeMutableBufferPointer { buffer in
      CMSampleBufferGetSampleTimingInfoArray(
        sampleBuffer,
        entryCount: needed,
        arrayToFill: buffer.baseAddress,
        entriesNeededOut: nil
      )
    }
    guard status == noErr else {
      throw AudioPeakLimiterError.invalidTiming("cannot copy sample timing")
    }

    for entry in timing {
      guard entry.duration.isNumeric,
            entry.duration > .zero,
            entry.presentationTimeStamp.isNumeric,
            entry.presentationTimeStamp.seconds.isFinite,
            entry.decodeTimeStamp == .invalid || entry.decodeTimeStamp.isNumeric
      else {
        throw AudioPeakLimiterError.invalidTiming("non-numeric sample timing")
      }
    }
    return timing
  }

  private func limit(
    _ buffer: AVAudioPCMBuffer,
    asbd: AudioStreamBasicDescription,
    frameCount: Int
  ) throws {
    let audioBuffers = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
    let isNonInterleaved = asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0
    let bytesPerFrame = isNonInterleaved ? 4 : channelCount * 4
    guard frameCount <= Int(UInt32.max) / bytesPerFrame else {
      throw AudioPeakLimiterError.invalidBuffer("PCM buffer is too large")
    }
    let requiredByteCount = UInt32(frameCount * bytesPerFrame)
    let framePointers: [UnsafeMutablePointer<Float>]

    if isNonInterleaved {
      guard audioBuffers.count == channelCount else {
        throw AudioPeakLimiterError.invalidBuffer("non-interleaved buffer count")
      }
      framePointers = try audioBuffers.map { audioBuffer in
        guard audioBuffer.mNumberChannels == 1,
              audioBuffer.mDataByteSize >= requiredByteCount,
              let data = audioBuffer.mData
        else {
          throw AudioPeakLimiterError.invalidBuffer("non-interleaved buffer layout")
        }
        return data.assumingMemoryBound(to: Float.self)
      }
    }
    else {
      guard audioBuffers.count == 1,
            audioBuffers[0].mNumberChannels == channelCount,
            audioBuffers[0].mDataByteSize >= requiredByteCount,
            let data = audioBuffers[0].mData
      else {
        throw AudioPeakLimiterError.invalidBuffer("interleaved buffer layout")
      }
      framePointers = [data.assumingMemoryBound(to: Float.self)]
    }

    for frame in 0..<frameCount {
      var peak: Float = 0
      if isNonInterleaved {
        for channel in 0..<channelCount {
          let sample = framePointers[channel][frame]
          guard sample.isFinite else {
            throw AudioPeakLimiterError.invalidBuffer("non-finite PCM sample")
          }
          peak = max(peak, abs(sample))
        }
      }
      else {
        let firstSample = frame * channelCount
        for channel in 0..<channelCount {
          let sample = framePointers[0][firstSample + channel]
          guard sample.isFinite else {
            throw AudioPeakLimiterError.invalidBuffer("non-finite PCM sample")
          }
          peak = max(peak, abs(sample))
        }
      }

      let targetGain = peak > ceiling ? ceiling / peak : 1
      if targetGain < gain {
        gain = targetGain
      }
      else {
        gain = min(1, gain + (1 - gain) * releaseCoefficient)
      }

      if isNonInterleaved {
        for channel in 0..<channelCount {
          let sample = framePointers[channel][frame] * gain
          guard sample.isFinite else {
            throw AudioPeakLimiterError.invalidBuffer("non-finite limited sample")
          }
          framePointers[channel][frame] = max(-ceiling, min(ceiling, sample))
        }
      }
      else {
        let firstSample = frame * channelCount
        for channel in 0..<channelCount {
          let sample = framePointers[0][firstSample + channel] * gain
          guard sample.isFinite else {
            throw AudioPeakLimiterError.invalidBuffer("non-finite limited sample")
          }
          framePointers[0][firstSample + channel] = max(-ceiling, min(ceiling, sample))
        }
      }
    }
  }

  private func makeSampleBuffer(
    pcmBuffer: AVAudioPCMBuffer,
    formatDescription: CMFormatDescription,
    timing: [CMSampleTimingInfo]
  ) throws -> CMSampleBuffer {
    var sampleBuffer: CMSampleBuffer?
    let createStatus = timing.withUnsafeBufferPointer { timingBuffer in
      CMSampleBufferCreate(
        allocator: kCFAllocatorDefault,
        dataBuffer: nil,
        dataReady: false,
        makeDataReadyCallback: nil,
        refcon: nil,
        formatDescription: formatDescription,
        sampleCount: CMItemCount(pcmBuffer.frameLength),
        sampleTimingEntryCount: CMItemCount(timingBuffer.count),
        sampleTimingArray: timingBuffer.baseAddress,
        sampleSizeEntryCount: 0,
        sampleSizeArray: nil,
        sampleBufferOut: &sampleBuffer
      )
    }
    guard createStatus == noErr, let sampleBuffer else {
      throw AudioPeakLimiterError.sampleBufferFailed(createStatus)
    }

    let setDataStatus = CMSampleBufferSetDataBufferFromAudioBufferList(
      sampleBuffer,
      blockBufferAllocator: kCFAllocatorDefault,
      blockBufferMemoryAllocator: kCFAllocatorDefault,
      flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
      bufferList: pcmBuffer.mutableAudioBufferList
    )
    guard setDataStatus == noErr else {
      throw AudioPeakLimiterError.sampleBufferFailed(setDataStatus)
    }
    let readyStatus = CMSampleBufferSetDataReady(sampleBuffer)
    guard readyStatus == noErr else {
      throw AudioPeakLimiterError.sampleBufferFailed(readyStatus)
    }
    return sampleBuffer
  }

  private func describe(_ asbd: AudioStreamBasicDescription) -> String {
    "\(Int(asbd.mSampleRate))Hz/\(asbd.mChannelsPerFrame)ch flags=\(asbd.mFormatFlags)"
  }
}

private enum AudioPeakLimiterError: Error, CustomStringConvertible {
  case invalidConfiguration(String)
  case invalidFormat(String)
  case invalidTiming(String)
  case invalidBuffer(String)
  case copyFailed(OSStatus)
  case sampleBufferFailed(OSStatus)

  var description: String {
    switch self {
    case let .invalidConfiguration(value): "invalid configuration: \(value)"
    case let .invalidFormat(value): "invalid format: \(value)"
    case let .invalidTiming(value): "invalid timing: \(value)"
    case let .invalidBuffer(value): "invalid buffer: \(value)"
    case let .copyFailed(status): "PCM copy failed: \(status)"
    case let .sampleBufferFailed(status): "sample buffer failed: \(status)"
    }
  }
}

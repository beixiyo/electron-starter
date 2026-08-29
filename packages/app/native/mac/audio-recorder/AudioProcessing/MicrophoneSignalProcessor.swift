// 对原始 Float32 麦克风 PCM 做统一的电平处理；raw sidecar 与 AEC clean 共用这一实现

import AVFoundation
import Foundation

/**
 * 对已归一为 Float32 PCM 的原始麦克风样本做自动增益、动态压缩和峰值保护
 *
 * 这个处理器只处理 raw 麦克风输入。AEC clean 在写入 sidecar 前复用同一个实例，
 * 因此两条路径使用同一套 4,800 样本目标窗口和逐采样平滑策略。它不是 AEC 或降噪器，
 * 也不表示底层输入已经经过系统级音频处理
 *
 * 实例由调用方的串行音频队列独占；回调只用于日志和电平观测，不接管资源生命周期
 */
public final class MicrophoneSignalProcessor: @unchecked Sendable {
  private enum Policy {
    static let targetRMSDBFS = -18.0
    static let maximumGainDB = 12.0
    static let peakCeilingDBFS = -1.0
    static let compressorThresholdDBFS = -12.0
    static let compressorRatio = 4.0
    static let compressorKneeDB = 6.0
    static let compressorAttackSeconds = 0.005
    static let compressorReleaseSeconds = 0.08
    static let signalRMSFloorDBFS = -50.0
    static let signalPeakFloorDBFS = -35.0
    static let minimumSignalDurationSeconds = 0.1
    static let gainRiseSeconds = 0.18
    static let gainFallSeconds = 0.005
    static let signalHoldSeconds = 0.15
    static let gainReleaseSeconds = 0.4
    static let signalResetSeconds = signalHoldSeconds + gainReleaseSeconds * 3
    static let expanderThresholdDBFS = -45.0
    static let expanderRangeDB = 18.0
    static let expanderKneeDB = 12.0
    static let expanderOpenSeconds = 0.01
    static let expanderCloseSeconds = 0.18
    static let meterDurationSeconds = 2.0
  }

  private let peakCeiling = amplitude(fromDBFS: Policy.peakCeilingDBFS)
  private let signalRMSFloor = amplitude(fromDBFS: Policy.signalRMSFloorDBFS)
  private let signalPeakFloor = amplitude(fromDBFS: Policy.signalPeakFloorDBFS)
  private let logger: (String) -> Void
  private let onInputRMS: (Float) -> Void

  private var currentGain: Float = 1
  private var compressorGain: Float = 1
  private var expanderGain: Float = 1
  private var signalRunSeconds = 0.0
  private var signalHoldRemainingSeconds = 0.0
  private var signalInactiveSeconds = 0.0
  private var signalConfirmed = false
  public private(set) var hasObservedSignal = false
  private var unsupportedFormatLogged = false
  private var nonFiniteSampleLogged = false

  private var meteredSampleCount: Int64 = 0
  private var inputSquareSum = 0.0
  private var inputPeak: Float = 0
  private var outputSquareSum = 0.0
  private var outputPeak: Float = 0
  private var appliedGainSum = 0.0
  private var appliedGainFrameCount: Int64 = 0
  private var meterLogged = false

  public init(
    logger: @escaping (String) -> Void = { _ in },
    onInputRMS: @escaping (Float) -> Void = { _ in }
  ) {
    self.logger = logger
    self.onInputRMS = onInputRMS
  }

  /** 原地处理一个 Float32 PCM buffer；不支持的格式保持原样并记一次诊断。 */
  public func process(_ buffer: AVAudioPCMBuffer) {
    guard buffer.format.commonFormat == .pcmFormatFloat32,
          let channels = buffer.floatChannelData,
          buffer.frameLength > 0,
          buffer.format.channelCount > 0
    else {
      if !unsupportedFormatLogged {
        logger(
          "microphone signal processing skipped: unsupported format "
            + describeMicrophoneFormat(buffer.format)
        )
        unsupportedFormatLogged = true
      }
      return
    }

    let frameCount = Int(buffer.frameLength)
    let channelCount = Int(buffer.format.channelCount)
    let isInterleaved = buffer.format.isInterleaved
    let pointerCount = isInterleaved ? 1 : channelCount
    let samplesPerPointer = isInterleaved ? frameCount * channelCount : frameCount

    var sanitizedNonFiniteSample = false
    var squareSum = 0.0
    var peak: Float = 0
    for pointerIndex in 0..<pointerCount {
      let samples = channels[pointerIndex]
      for sampleIndex in 0..<samplesPerPointer {
        var sample = samples[sampleIndex]
        if !sample.isFinite {
          samples[sampleIndex] = 0
          sample = 0
          sanitizedNonFiniteSample = true
        }
        squareSum += Double(sample) * Double(sample)
        peak = max(peak, abs(sample))
      }
    }

    if sanitizedNonFiniteSample, !nonFiniteSampleLogged {
      logger("microphone signal processing: non-finite PCM sample zeroed")
      nonFiniteSampleLogged = true
    }

    let sampleCount = max(1, frameCount * channelCount)
    let rms = Float(sqrt(squareSum / Double(sampleCount)))
    onInputRMS(rms)
    let containsSignal = rms >= signalRMSFloor && peak >= signalPeakFloor
    let bufferDuration = Double(frameCount) / max(1, buffer.format.sampleRate)

    /** 目标按当前 buffer 求，增益推进在下面按样本进行，避免 buffer 边界的台阶。 */
    var agcTarget: Float?
    var agcRamp = GainRamp.rise
    var agcHoldFrames = 0
    if containsSignal {
      signalInactiveSeconds = 0
      signalRunSeconds += bufferDuration
      if signalRunSeconds >= Policy.minimumSignalDurationSeconds {
        signalConfirmed = true
        hasObservedSignal = true
      }
      if signalConfirmed {
        signalHoldRemainingSeconds = Policy.signalHoldSeconds
        agcTarget = desiredGain(rms: rms)
      }
    }
    else {
      signalRunSeconds = 0
      if signalConfirmed {
        let holdBeforeBuffer = signalHoldRemainingSeconds
        signalInactiveSeconds += bufferDuration
        signalHoldRemainingSeconds = max(0, holdBeforeBuffer - bufferDuration)
        agcHoldFrames = min(
          frameCount,
          Int((holdBeforeBuffer * buffer.format.sampleRate).rounded())
        )
        if agcHoldFrames < frameCount {
          agcTarget = 1
          agcRamp = .release
        }
        if signalInactiveSeconds >= Policy.signalResetSeconds {
          signalConfirmed = false
          signalInactiveSeconds = 0
          currentGain = 1
          agcTarget = nil
        }
      }
    }

    let expanderTarget = expanderTargetGain(rms: rms, containsSignal: containsSignal)
    let smoothingStepSeconds = 1 / max(1, buffer.format.sampleRate)

    var processedSquareSum = 0.0
    var processedPeak: Float = 0
    var appliedGainFrameSum = 0.0
    for frameIndex in 0..<frameCount {
      var framePeak: Float = 0
      if isInterleaved {
        let samples = channels[0]
        let frameOffset = frameIndex * channelCount
        for channelIndex in 0..<channelCount {
          framePeak = max(framePeak, abs(samples[frameOffset + channelIndex]))
        }
      }
      else {
        for channelIndex in 0..<channelCount {
          framePeak = max(framePeak, abs(channels[channelIndex][frameIndex]))
        }
      }

      if let agcTarget, frameIndex >= agcHoldFrames {
        advanceGain(toward: agcTarget, ramp: agcRamp, stepSeconds: smoothingStepSeconds)
      }
      updateExpanderGain(toward: expanderTarget, stepSeconds: smoothingStepSeconds)

      let desiredAppliedGain: Float = signalConfirmed ? currentGain : 1
      updateCompressorGain(
        toward: compressionGain(for: framePeak * desiredAppliedGain),
        sampleRate: buffer.format.sampleRate
      )

      let combinedGain = desiredAppliedGain * compressorGain * expanderGain
      let peakSafeGain = framePeak > 0 ? peakCeiling / framePeak : combinedGain
      let appliedGain = max(0, min(combinedGain, peakSafeGain))
      appliedGainFrameSum += Double(appliedGain)

      if isInterleaved {
        let samples = channels[0]
        let frameOffset = frameIndex * channelCount
        for channelIndex in 0..<channelCount {
          let sampleIndex = frameOffset + channelIndex
          let processed = max(
            -peakCeiling,
            min(peakCeiling, samples[sampleIndex] * appliedGain)
          )
          samples[sampleIndex] = processed
          processedSquareSum += Double(processed * processed)
          processedPeak = max(processedPeak, abs(processed))
        }
      }
      else {
        for channelIndex in 0..<channelCount {
          let samples = channels[channelIndex]
          let processed = max(
            -peakCeiling,
            min(peakCeiling, samples[frameIndex] * appliedGain)
          )
          samples[frameIndex] = processed
          processedSquareSum += Double(processed * processed)
          processedPeak = max(processedPeak, abs(processed))
        }
      }
    }

    recordMeter(
      buffer: buffer,
      sampleCount: sampleCount,
      inputSquareSum: squareSum,
      inputPeak: peak,
      outputSquareSum: processedSquareSum,
      outputPeak: processedPeak,
      appliedGainFrameSum: appliedGainFrameSum
    )
  }

  private func desiredGain(rms: Float) -> Float {
    guard rms > 0 else { return 1 }
    let gainDB = min(Policy.maximumGainDB, max(0, Policy.targetRMSDBFS - dbFS(rms)))
    return amplitude(fromDBFS: gainDB)
  }

  private func expanderTargetGain(rms: Float, containsSignal: Bool) -> Float {
    if containsSignal { return 1 }
    let distanceBelowThreshold = max(0, Policy.expanderThresholdDBFS - dbFS(rms))
    let attenuationDB = min(
      Policy.expanderRangeDB,
      Policy.expanderRangeDB * distanceBelowThreshold / Policy.expanderKneeDB
    )
    return amplitude(fromDBFS: -attenuationDB)
  }

  private func updateExpanderGain(toward target: Float, stepSeconds: Double) {
    let timeConstant = target > expanderGain
      ? Policy.expanderOpenSeconds
      : Policy.expanderCloseSeconds
    let alpha = Float(1 - exp(-stepSeconds / timeConstant))
    expanderGain += (target - expanderGain) * alpha
  }

  private func advanceGain(toward target: Float, ramp: GainRamp, stepSeconds: Double) {
    let timeConstant: Double = switch ramp {
    case .rise: target <= currentGain ? Policy.gainFallSeconds : Policy.gainRiseSeconds
    case .release: Policy.gainReleaseSeconds
    }
    let alpha = Float(1 - exp(-stepSeconds / timeConstant))
    currentGain += (target - currentGain) * alpha
    if ramp == .release, abs(currentGain - 1) < 0.001 {
      currentGain = 1
    }
  }

  private func compressionGain(for amplifiedPeak: Float) -> Float {
    guard amplifiedPeak > 0 else { return 1 }
    let inputDB = dbFS(amplifiedPeak)
    let lowerKnee = Policy.compressorThresholdDBFS - Policy.compressorKneeDB / 2
    let upperKnee = Policy.compressorThresholdDBFS + Policy.compressorKneeDB / 2
    let outputDB: Double
    if inputDB <= lowerKnee {
      return 1
    }
    else if inputDB >= upperKnee {
      outputDB = Policy.compressorThresholdDBFS
        + (inputDB - Policy.compressorThresholdDBFS) / Policy.compressorRatio
    }
    else {
      let distanceIntoKnee = inputDB - lowerKnee
      outputDB = inputDB
        + (1 / Policy.compressorRatio - 1)
          * distanceIntoKnee * distanceIntoKnee / (2 * Policy.compressorKneeDB)
    }
    return amplitude(fromDBFS: min(0, outputDB - inputDB))
  }

  private func updateCompressorGain(toward target: Float, sampleRate: Double) {
    let timeConstant = target < compressorGain
      ? Policy.compressorAttackSeconds
      : Policy.compressorReleaseSeconds
    let coefficient = Float(exp(-1 / (max(1, sampleRate) * timeConstant)))
    compressorGain = target + (compressorGain - target) * coefficient
  }

  private enum GainRamp {
    case rise
    case release
  }

  private func recordMeter(
    buffer: AVAudioPCMBuffer,
    sampleCount: Int,
    inputSquareSum: Double,
    inputPeak: Float,
    outputSquareSum: Double,
    outputPeak: Float,
    appliedGainFrameSum: Double
  ) {
    guard !meterLogged else { return }

    meteredSampleCount += Int64(sampleCount)
    self.inputSquareSum += inputSquareSum
    self.inputPeak = max(self.inputPeak, inputPeak)
    self.outputSquareSum += outputSquareSum
    self.outputPeak = max(self.outputPeak, outputPeak)
    appliedGainSum += appliedGainFrameSum
    appliedGainFrameCount += Int64(buffer.frameLength)

    let targetSampleCount = Int64(
      buffer.format.sampleRate
        * Policy.meterDurationSeconds
        * Double(buffer.format.channelCount)
    )
    guard meteredSampleCount >= targetSampleCount else { return }

    let inputRMS = sqrt(self.inputSquareSum / Double(max(1, meteredSampleCount)))
    let outputRMS = sqrt(self.outputSquareSum / Double(max(1, meteredSampleCount)))
    let averageGain = appliedGainSum / Double(max(1, appliedGainFrameCount))
    let averageGainDB = 20 * log10(max(averageGain, 0.000_000_001))
    logger(
      "mic level first 2s input=\(formatDBFS(inputRMS))/\(formatDBFS(Double(self.inputPeak)))dBFS "
        + "output=\(formatDBFS(outputRMS))/\(formatDBFS(Double(self.outputPeak)))dBFS "
        + "averageGain=\(String(format: "%.1f", averageGainDB))dB"
    )
    meterLogged = true
  }
}

private func amplitude(fromDBFS value: Double) -> Float {
  Float(pow(10, value / 20))
}

private func dbFS(_ amplitude: Float) -> Double {
  20 * log10(max(Double(amplitude), 0.000_000_001))
}

private func formatDBFS(_ amplitude: Double) -> String {
  String(format: "%.1f", 20 * log10(max(amplitude, 0.000_000_001)))
}

private func describeMicrophoneFormat(_ format: AVAudioFormat) -> String {
  "\(Int(format.sampleRate))Hz/\(format.channelCount)ch/\(format.commonFormat.rawValue)"
}

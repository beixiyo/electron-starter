// 对 Float32 麦克风 PCM 应用有上限的人声自动增益和峰值保护

import AVFoundation

/**
 * 对已归一为 Float32 PCM 的麦克风样本做受限自动增益
 *
 * 输入是 AVAudioEngine / AVCapture 的原始麦克风 PCM，输出仍是同样格式的 PCM；
 * 只在检测到语音级信号时追踪目标 RMS，并用峰值上限防止增益后削波。
 * 它不是降噪器：Voice Processing 不可用时不会伪造 AEC/NS 能力。
 *
 * 该对象由 sampleQueue 独占，不提供跨线程同步
 */
final class MicrophoneSignalProcessor {
  private enum Policy {
    /** 语音段目标电平，为瞬时峰值保留约 19 dB 空间 */
    static let targetRMSDbFS = -20.0
    /** 不对弱输入无限拉升，避免同比放大底噪 */
    static let maximumGainDb = 12.0
    /** 峰值留 1 dB 编码余量 */
    static let peakCeilingDbFS = -1.0
    /** RMS 与峰值都达到门槛才视为人声，避免单个噪声尖峰触发增益和系统音衰减 */
    static let signalRMSFloorDbFS = -50.0
    static let signalPeakFloorDbFS = -35.0
    /** 连续达到门槛一小段时间后才确认整场存在人声 */
    static let minimumSignalDurationSeconds = 0.1
    /** 电平变小时平滑抬升，防止首帧跳变和 buffer 间的呼吸感 */
    static let gainRiseTimeSeconds = 0.35
    /** 短暂低于门槛时保留语音增益，之后平滑回到 1 倍 */
    static let signalHoldSeconds = 0.15
    static let gainReleaseTimeSeconds = 0.4
    /** 长静音后重新要求 100ms 确认，避免旧会话 latch 让新噪声立即触发 AGC */
    static let signalResetSeconds = signalHoldSeconds + gainReleaseTimeSeconds * 3
    static let meterDurationSeconds = 2.0
  }

  private let peakCeiling = amplitude(fromDbFS: Policy.peakCeilingDbFS)
  private let signalRMSFloor = amplitude(fromDbFS: Policy.signalRMSFloorDbFS)
  private let signalPeakFloor = amplitude(fromDbFS: Policy.signalPeakFloorDbFS)

  private var currentGain: Float = 1
  private var signalRunSeconds = 0.0
  private var signalHoldRemainingSeconds = 0.0
  private var signalInactiveSeconds = 0.0
  private var signalConfirmed = false
  private(set) var hasObservedSignal = false
  private var unsupportedFormatLogged = false

  private var meteredSampleCount: Int64 = 0
  private var inputSquareSum = 0.0
  private var inputPeak: Float = 0
  private var outputSquareSum = 0.0
  private var outputPeak: Float = 0
  private var appliedGainSum = 0.0
  private var appliedGainFrameCount: Int64 = 0
  private var meterLogged = false

  /** 原地处理一个 PCM buffer，非 Float32 格式保持原样本 */
  func process(_ buffer: AVAudioPCMBuffer) {
    guard buffer.format.commonFormat == .pcmFormatFloat32,
          let channels = buffer.floatChannelData,
          buffer.frameLength > 0,
          buffer.format.channelCount > 0
    else {
      if !unsupportedFormatLogged {
        log("mic signal processing skipped: unsupported format \(describeAudioFormat(buffer.format))")
        unsupportedFormatLogged = true
      }
      return
    }

    let frameCount = Int(buffer.frameLength)
    let channelCount = Int(buffer.format.channelCount)
    let isInterleaved = buffer.format.isInterleaved
    let pointerCount = isInterleaved ? 1 : channelCount
    let samplesPerPointer = isInterleaved
      ? frameCount * channelCount
      : frameCount

    var squareSum = 0.0
    var peak: Float = 0
    for pointerIndex in 0..<pointerCount {
      let samples = channels[pointerIndex]
      for sampleIndex in 0..<samplesPerPointer {
        let sample = samples[sampleIndex]
        squareSum += Double(sample * sample)
        peak = max(peak, abs(sample))
      }
    }

    let sampleCount = max(1, frameCount * channelCount)
    let rms = Float(sqrt(squareSum / Double(sampleCount)))
    let containsSignal = rms >= signalRMSFloor && peak >= signalPeakFloor
    let bufferDuration = Double(frameCount) / max(1, buffer.format.sampleRate)
    if containsSignal {
      signalInactiveSeconds = 0
      signalRunSeconds += bufferDuration
      if signalRunSeconds >= Policy.minimumSignalDurationSeconds {
        signalConfirmed = true
        hasObservedSignal = true
      }
      if signalConfirmed {
        signalHoldRemainingSeconds = Policy.signalHoldSeconds
        updateSmoothedGain(
          desiredGain: desiredGainForSignal(rms: rms),
          duration: bufferDuration
        )
      }
    }
    else {
      signalRunSeconds = 0
      if signalConfirmed {
        signalInactiveSeconds += bufferDuration
        let releaseDuration = max(0, bufferDuration - signalHoldRemainingSeconds)
        signalHoldRemainingSeconds = max(0, signalHoldRemainingSeconds - bufferDuration)
        if releaseDuration > 0 {
          releaseGainTowardUnity(duration: releaseDuration)
        }
        if signalInactiveSeconds >= Policy.signalResetSeconds {
          signalConfirmed = false
          signalInactiveSeconds = 0
          currentGain = 1
        }
      }
    }

    /** 人声确认前不放大候选噪声；确认后短暂保持并平滑回落，所有路径仍受峰值上限保护 */
    let peakSafeGain = peak > 0 ? peakCeiling / peak : currentGain
    let desiredAppliedGain: Float = signalConfirmed ? currentGain : 1
    let appliedGain = max(0, min(desiredAppliedGain, peakSafeGain))

    var processedSquareSum = 0.0
    var processedPeak: Float = 0
    for pointerIndex in 0..<pointerCount {
      let samples = channels[pointerIndex]
      for sampleIndex in 0..<samplesPerPointer {
        let processed = max(-peakCeiling, min(peakCeiling, samples[sampleIndex] * appliedGain))
        samples[sampleIndex] = processed
        processedSquareSum += Double(processed * processed)
        processedPeak = max(processedPeak, abs(processed))
      }
    }

    recordMeter(
      buffer: buffer,
      sampleCount: sampleCount,
      inputSquareSum: squareSum,
      inputPeak: peak,
      outputSquareSum: processedSquareSum,
      outputPeak: processedPeak,
      appliedGain: appliedGain
    )
  }

  private func desiredGainForSignal(rms: Float) -> Float {
    guard rms > 0 else { return 1 }
    let rmsDbFS = dbFS(rms)
    let gainDb = min(Policy.maximumGainDb, max(0, Policy.targetRMSDbFS - rmsDbFS))
    return Float(pow(10.0, gainDb / 20))
  }

  private func updateSmoothedGain(
    desiredGain: Float,
    duration: Double
  ) {
    if desiredGain <= currentGain {
      /** 输入突然变大时立即收低增益，优先避免削波 */
      currentGain = desiredGain
      return
    }

    let alpha = Float(1 - exp(-duration / Policy.gainRiseTimeSeconds))
    currentGain += (desiredGain - currentGain) * alpha
  }

  private func releaseGainTowardUnity(duration: Double) {
    let alpha = Float(1 - exp(-duration / Policy.gainReleaseTimeSeconds))
    currentGain += (1 - currentGain) * alpha
    if abs(currentGain - 1) < 0.001 {
      currentGain = 1
    }
  }

  private func recordMeter(
    buffer: AVAudioPCMBuffer,
    sampleCount: Int,
    inputSquareSum: Double,
    inputPeak: Float,
    outputSquareSum: Double,
    outputPeak: Float,
    appliedGain: Float
  ) {
    guard !meterLogged else { return }

    meteredSampleCount += Int64(sampleCount)
    self.inputSquareSum += inputSquareSum
    self.inputPeak = max(self.inputPeak, inputPeak)
    self.outputSquareSum += outputSquareSum
    self.outputPeak = max(self.outputPeak, outputPeak)
    appliedGainSum += Double(appliedGain) * Double(buffer.frameLength)
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
    let averageGainDb = 20 * log10(max(averageGain, 0.000_000_001))
    log(
      "mic level first 2s input=\(formatDbFS(inputRMS))/\(formatDbFS(Double(self.inputPeak)))dBFS "
        + "output=\(formatDbFS(outputRMS))/\(formatDbFS(Double(self.outputPeak)))dBFS "
        + "averageGain=\(String(format: "%.1f", averageGainDb))dB"
    )
    meterLogged = true
  }
}

private func amplitude(fromDbFS value: Double) -> Float {
  Float(pow(10, value / 20))
}

private func dbFS(_ amplitude: Float) -> Double {
  20 * log10(max(Double(amplitude), 0.000_000_001))
}

private func formatDbFS(_ amplitude: Double) -> String {
  String(format: "%.1f", 20 * log10(max(amplitude, 0.000_000_001)))
}

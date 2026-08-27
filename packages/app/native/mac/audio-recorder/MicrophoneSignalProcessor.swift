// 对 Float32 麦克风 PCM 应用人声自动增益、动态压缩和峰值保护

import AVFoundation

/**
 * 对已归一为 Float32 PCM 的麦克风样本做模式化电平处理
 *
 * 输入是 AVAudioEngine / AVCapture 的原始麦克风 PCM，输出仍是同样格式的 PCM；
 * Voice Processing 已包含 NS / AGC，只允许少量补偿；raw 采集使用更高但受限的增益；
 * 两种模式都用平滑 downward expander 衰减停顿期底噪，并压缩瞬时峰值；
 * 最后逐采样帧限制峰值，避免一个爆破音压低整块 buffer 或造成削波
 * 它不是降噪器：Voice Processing 不可用时不会伪造 AEC/NS 能力
 *
 * 该对象由 sampleQueue 独占，不提供跨线程同步
 */
final class MicrophoneSignalProcessor {
  private enum Policy {
    /** raw capture 没有系统 AGC，先把语音主体推向该 RMS，再由压缩器控制瞬时峰值 */
    static let targetRMSDbFS = -18.0
    /** VPIO 已经执行系统 AGC，额外增益只补偿轻微电平差，避免再次抬高残余底噪 */
    static let voiceProcessedMaximumGainDb = 6.0
    /** raw capture 没有系统 AGC，但也不对弱输入无限拉升 */
    static let rawMaximumGainDb = 12.0
    /** 峰值留 1 dB 编码余量 */
    static let peakCeilingDbFS = -1.0
    /** 只压缩高于人声主体的瞬时峰值，让 RMS 可以达到目标而不削波 */
    static let compressorThresholdDbFS = -12.0
    static let compressorRatio = 4.0
    static let compressorKneeDb = 6.0
    static let compressorAttackSeconds = 0.005
    static let compressorReleaseSeconds = 0.08
    /** RMS 与峰值都达到门槛才视为人声，避免单个噪声尖峰触发增益和系统音衰减 */
    static let signalRMSFloorDbFS = -50.0
    static let signalPeakFloorDbFS = -35.0
    /** 连续达到门槛一小段时间后才确认整场存在人声 */
    static let minimumSignalDurationSeconds = 0.1
    /** 电平变小时平滑抬升，兼顾短录音起音与 buffer 间稳定性 */
    static let gainRiseTimeSeconds = 0.18
    /**
     * 输入突然变大时快速收低增益
     *
     * 原实现直接把 currentGain 赋成目标值，在 buffer 粒度上表现为增益瞬跳；
     * 改为逐采样的短时间常数。削波保护不依赖这里的瞬时性——帧循环里的
     * peakSafeGain 仍逐帧硬限幅
     */
    static let gainFallTimeSeconds = 0.005
    /** 短暂低于门槛时保留语音增益，之后平滑回到 1 倍 */
    static let signalHoldSeconds = 0.15
    static let gainReleaseTimeSeconds = 0.4
    /** 长静音后重新要求 100ms 确认，避免旧会话 latch 让新噪声立即触发 AGC */
    static let signalResetSeconds = signalHoldSeconds + gainReleaseTimeSeconds * 3
    /** 低电平区使用软扩展器，而不是硬 gate，避免吞掉句首、尾音和轻声 */
    static let voiceProcessedExpanderThresholdDbFS = -48.0
    static let rawExpanderThresholdDbFS = -45.0
    static let expanderRangeDb = 18.0
    static let expanderKneeDb = 12.0
    static let expanderOpenSeconds = 0.01
    static let expanderCloseSeconds = 0.18
    static let meterDurationSeconds = 2.0
  }

  private let peakCeiling = amplitude(fromDbFS: Policy.peakCeilingDbFS)
  private let signalRMSFloor = amplitude(fromDbFS: Policy.signalRMSFloorDbFS)
  private let signalPeakFloor = amplitude(fromDbFS: Policy.signalPeakFloorDbFS)

  private var currentGain: Float = 1
  private var compressorGain: Float = 1
  private var expanderGain: Float = 1
  private var activeMode: MicCaptureProcessingMode?
  private var signalRunSeconds = 0.0
  private var signalHoldRemainingSeconds = 0.0
  private var signalInactiveSeconds = 0.0
  private var signalConfirmed = false
  private(set) var hasObservedSignal = false
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

  /** 原地处理一个 PCM buffer，非 Float32 格式保持原样本 */
  func process(_ buffer: AVAudioPCMBuffer, mode: MicCaptureProcessingMode) {
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

    /** 音频设备异常时可能交付 NaN/Inf；先原地归零，绝不把非有限值写入 CAF */
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
      log("mic signal processing: non-finite PCM sample zeroed")
      nonFiniteSampleLogged = true
    }

    let sampleCount = max(1, frameCount * channelCount)
    let rms = Float(sqrt(squareSum / Double(sampleCount)))
    /** 只读不改：渲染层要的是增益之前的电平，理由见 `AudioLevelMeter` */
    AudioLevelMeter.shared.submit(inputRMS: rms)
    let containsSignal = rms >= signalRMSFloor && peak >= signalPeakFloor
    let bufferDuration = Double(frameCount) / max(1, buffer.format.sampleRate)
    switchModeIfNeeded(mode)

    /**
     * 增益目标按 buffer 求，推进放到帧循环里逐采样进行
     *
     * 原实现把 currentGain 与 expanderGain 当整块常量，只在 buffer 边界更新，于是每个
     * 100 ms buffer 边界上都出现一次增益台阶。实测成品波形每 4800 采样一道拼接缝：
     * 说话时统计显著，恒定底噪时不可见——因为那时增益本来就不动。
     * 平滑时间常数也一并失效过：duration 传的是 bufferDuration，
     * expanderOpenSeconds = 10 ms 在 100 ms 步长下 alpha ≈ 0.99995，等于瞬间到位
     */
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
        agcTarget = desiredGainForSignal(rms: rms, mode: mode)
      }
    }
    else {
      signalRunSeconds = 0
      if signalConfirmed {
        let holdBeforeBuffer = signalHoldRemainingSeconds
        signalInactiveSeconds += bufferDuration
        signalHoldRemainingSeconds = max(0, holdBeforeBuffer - bufferDuration)
        /** hold 覆盖的前若干采样保持原增益，其后才开始回落，保留原 hold 语义 */
        agcHoldFrames = min(frameCount, Int((holdBeforeBuffer * buffer.format.sampleRate).rounded()))
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

    let expanderTarget = expanderTargetGain(rms: rms, containsSignal: containsSignal, mode: mode)
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
        advanceSmoothedGain(toward: agcTarget, ramp: agcRamp, stepSeconds: smoothingStepSeconds)
      }
      updateExpanderGain(targetGain: expanderTarget, duration: smoothingStepSeconds)

      /** 人声确认前不放大候选噪声；确认后短暂保持并平滑回落 */
      let desiredAppliedGain: Float = signalConfirmed ? currentGain : 1
      updateCompressorGain(
        targetGain: compressionGain(for: framePeak * desiredAppliedGain),
        sampleRate: buffer.format.sampleRate
      )

      let compressedGain = desiredAppliedGain * compressorGain * expanderGain
      /** 峰值保护只作用于当前采样帧，不再因单个瞬时峰值压低整个 buffer */
      let peakSafeGain = framePeak > 0 ? peakCeiling / framePeak : compressedGain
      let appliedGain = max(0, min(compressedGain, peakSafeGain))
      appliedGainFrameSum += Double(appliedGain)

      if isInterleaved {
        let samples = channels[0]
        let frameOffset = frameIndex * channelCount
        for channelIndex in 0..<channelCount {
          let sampleIndex = frameOffset + channelIndex
          let processed = max(-peakCeiling, min(peakCeiling, samples[sampleIndex] * appliedGain))
          samples[sampleIndex] = processed
          processedSquareSum += Double(processed * processed)
          processedPeak = max(processedPeak, abs(processed))
        }
      }
      else {
        for channelIndex in 0..<channelCount {
          let samples = channels[channelIndex]
          let processed = max(-peakCeiling, min(peakCeiling, samples[frameIndex] * appliedGain))
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

  private func desiredGainForSignal(rms: Float, mode: MicCaptureProcessingMode) -> Float {
    guard rms > 0 else { return 1 }
    let rmsDbFS = dbFS(rms)
    let maximumGainDb = mode == .voiceProcessed
      ? Policy.voiceProcessedMaximumGainDb
      : Policy.rawMaximumGainDb
    let gainDb = min(maximumGainDb, max(0, Policy.targetRMSDbFS - rmsDbFS))
    return Float(pow(10.0, gainDb / 20))
  }

  /**
   * 信号达到人声双门槛时立即完全打开，避免等待确认窗口吞掉句首；低于噪声门槛时
   * 在软膝范围内逐渐衰减，最深只降固定 range，不制造绝对静音的开关感
   */
  private func expanderTargetGain(
    rms: Float,
    containsSignal: Bool,
    mode: MicCaptureProcessingMode
  ) -> Float {
    if containsSignal {
      return 1
    }

    let threshold = mode == .voiceProcessed
      ? Policy.voiceProcessedExpanderThresholdDbFS
      : Policy.rawExpanderThresholdDbFS
    let rmsDbFS = dbFS(rms)
    let distanceBelowThreshold = max(0, threshold - rmsDbFS)
    let attenuationDb = min(
      Policy.expanderRangeDb,
      Policy.expanderRangeDb * distanceBelowThreshold / Policy.expanderKneeDb
    )
    return amplitude(fromDbFS: -attenuationDb)
  }

  private func updateExpanderGain(targetGain: Float, duration: Double) {
    let timeConstant = targetGain > expanderGain
      ? Policy.expanderOpenSeconds
      : Policy.expanderCloseSeconds
    let alpha = Float(1 - exp(-duration / timeConstant))
    expanderGain += (targetGain - expanderGain) * alpha
  }

  /** 设备恢复可能在 VPIO 与 raw 间切换，模式变化时不继承上一条处理链的动态状态 */
  private func switchModeIfNeeded(_ mode: MicCaptureProcessingMode) {
    guard activeMode != mode else { return }
    activeMode = mode
    currentGain = 1
    compressorGain = 1
    expanderGain = 1
    signalRunSeconds = 0
    signalHoldRemainingSeconds = 0
    signalInactiveSeconds = 0
    signalConfirmed = false
    log("mic signal processing mode=\(mode.rawValue)")
  }

  /** 返回软膝压缩器对当前峰值应施加的线性增益 */
  private func compressionGain(for amplifiedPeak: Float) -> Float {
    guard amplifiedPeak > 0 else { return 1 }

    let inputDb = dbFS(amplifiedPeak)
    let threshold = Policy.compressorThresholdDbFS
    let knee = Policy.compressorKneeDb
    let lowerKnee = threshold - knee / 2
    let upperKnee = threshold + knee / 2
    let outputDb: Double

    if inputDb <= lowerKnee {
      return 1
    }
    else if inputDb >= upperKnee {
      outputDb = threshold + (inputDb - threshold) / Policy.compressorRatio
    }
    else {
      let distanceIntoKnee = inputDb - lowerKnee
      outputDb = inputDb
        + (1 / Policy.compressorRatio - 1)
          * distanceIntoKnee * distanceIntoKnee / (2 * knee)
    }

    return amplitude(fromDbFS: min(0, outputDb - inputDb))
  }

  private func updateCompressorGain(targetGain: Float, sampleRate: Double) {
    let duration = targetGain < compressorGain
      ? Policy.compressorAttackSeconds
      : Policy.compressorReleaseSeconds
    let coefficient = Float(exp(-1 / (max(1, sampleRate) * duration)))
    compressorGain = targetGain + (compressorGain - targetGain) * coefficient
  }

  /** 增益推进方向：抬升走 rise/fall 常数，人声结束后的回落走 release 常数 */
  private enum GainRamp {
    case rise
    case release
  }

  /**
   * 以单采样步长把 currentGain 推向目标
   *
   * 逐采样调用，因此 Policy 里的时间常数才是它字面的意思；不再出现 buffer 边界台阶
   */
  private func advanceSmoothedGain(toward target: Float, ramp: GainRamp, stepSeconds: Double) {
    let timeConstant: Double = switch ramp {
    case .release: Policy.gainReleaseTimeSeconds
    case .rise: target <= currentGain ? Policy.gainFallTimeSeconds : Policy.gainRiseTimeSeconds
    }
    let alpha = Float(1 - exp(-stepSeconds / timeConstant))
    currentGain += (target - currentGain) * alpha
    if ramp == .release, abs(currentGain - 1) < 0.001 {
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

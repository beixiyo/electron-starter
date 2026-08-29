// WebRTC AEC3 的 Swift 端帧级封装；C ABI 只暴露固定的 48 kHz / 10 ms mono 合约

import Foundation
import RecorderAPM

public enum WebRTCAPMError: Error, CustomStringConvertible, Equatable {
  case invalidConfiguration(String)
  case processingFailed(String)

  public var description: String {
    switch self {
    case .invalidConfiguration(let detail): "WebRTC AEC3 configuration error: \(detail)"
    case .processingFailed(let detail): "WebRTC AEC3 processing error: \(detail)"
    }
  }
}

public final class WebRTCAPMProcessor: @unchecked Sendable {
  public let implementationVersion: String

  private var handle: OpaquePointer?

  public init(options: AudioProcessingOptions) throws {
    guard options.processor == .webrtcAec3 else {
      throw WebRTCAPMError.invalidConfiguration("processor must be webrtcAec3")
    }

    var config = RecorderAPMConfig(
      echo_canceller_enabled: 1,
      noise_suppression_level: options.noiseSuppression.shimValue,
      gain_control_mode: options.gainControl.shimValue,
      high_pass_filter_enabled: options.highPass ? 1 : 0,
      maximum_internal_processing_rate_hz: Int32(AUDIO_PROCESSING_SAMPLE_RATE)
    )
    var status = RECORDER_APM_INVALID_ARGUMENT
    handle = recorder_apm_create(&config, &status)
    guard handle != nil, status == RECORDER_APM_OK else {
      throw WebRTCAPMError.processingFailed("create failed with status \(status.rawValue)")
    }
    implementationVersion = String(cString: recorder_apm_version())
  }

  deinit {
    recorder_apm_destroy(handle)
  }

  public func processFrame(
    render: inout [Float],
    capture: inout [Float],
    delayMS: Int,
    clean: inout [Float]
  ) throws {
    guard render.count == AUDIO_PROCESSING_FRAME_SAMPLES,
          capture.count == AUDIO_PROCESSING_FRAME_SAMPLES,
          clean.count == AUDIO_PROCESSING_FRAME_SAMPLES,
          let handle else {
      throw WebRTCAPMError.invalidConfiguration("frame buffers must contain 480 samples")
    }
    guard (0...AUDIO_PROCESSING_MAX_DELAY_MS).contains(delayMS) else {
      throw WebRTCAPMError.invalidConfiguration("delay must be between 0 and 500 ms")
    }

    let status = render.withUnsafeBufferPointer { renderPointer in
      capture.withUnsafeBufferPointer { capturePointer in
        clean.withUnsafeMutableBufferPointer { cleanPointer in
          recorder_apm_process_frame(
            handle,
            renderPointer.baseAddress,
            capturePointer.baseAddress,
            renderPointer.count,
            Int32(delayMS),
            cleanPointer.baseAddress
          )
        }
      }
    }
    guard status == RECORDER_APM_OK else {
      throw WebRTCAPMError.processingFailed(
        "frame failed with status \(status.rawValue), upstream=\(recorder_apm_last_webrtc_error(handle))"
      )
    }
  }

  public var clippedInputSamples: UInt64 {
    guard let handle else { return 0 }
    return recorder_apm_clipped_input_samples(handle)
  }
}

private extension AudioNoiseSuppressionLevel {
  var shimValue: RecorderAPMNoiseSuppressionLevel {
    switch self {
    case .off: RECORDER_APM_NS_OFF
    case .low: RECORDER_APM_NS_LOW
    case .moderate: RECORDER_APM_NS_MODERATE
    case .high: RECORDER_APM_NS_HIGH
    case .veryHigh: RECORDER_APM_NS_VERY_HIGH
    }
  }
}

private extension AudioGainControlMode {
  var shimValue: RecorderAPMGainControlMode {
    switch self {
    case .off: RECORDER_APM_AGC_OFF
    case .agc1AdaptiveDigital: RECORDER_APM_AGC1_ADAPTIVE_DIGITAL
    case .agc1Fixed: RECORDER_APM_AGC1_FIXED_DIGITAL
    case .agc2: RECORDER_APM_AGC2_ADAPTIVE_DIGITAL
    }
  }
}

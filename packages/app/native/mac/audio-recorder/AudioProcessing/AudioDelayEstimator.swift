// 在共同时间轴上估计 reference 到 capture 的非负延迟

import Foundation

public struct AudioDelayDecision: Sendable, Equatable {
  public let delayMS: Int
  public let correlation: Double?
  public let searchBoundaryHit: Bool
  public let usedFallback: Bool

  public init(delayMS: Int, correlation: Double?, searchBoundaryHit: Bool, usedFallback: Bool) {
    self.delayMS = delayMS
    self.correlation = correlation
    self.searchBoundaryHit = searchBoundaryHit
    self.usedFallback = usedFallback
  }
}

public enum AudioDelayEstimator {
  private static let hybridRadiusMS = 120
  private static let minimumCorrelation = 0.2

  public static func decide(
    captureEnvelope: [Float],
    referenceEnvelope: [Float],
    options: AudioProcessingOptions
  ) -> AudioDelayDecision {
    let fixed = max(0, min(AUDIO_PROCESSING_MAX_DELAY_MS, options.fixedDelayMS))
    let searchRange: ClosedRange<Int>
    switch options.delayMode {
    case .fixed:
      return AudioDelayDecision(delayMS: fixed, correlation: nil, searchBoundaryHit: false, usedFallback: false)
    case .auto:
      searchRange = 0...AUDIO_PROCESSING_MAX_DELAY_MS
    case .hybrid:
      searchRange = max(0, fixed - hybridRadiusMS)...min(
        AUDIO_PROCESSING_MAX_DELAY_MS,
        fixed + hybridRadiusMS
      )
    }

    let frameRange = (searchRange.lowerBound / AUDIO_PROCESSING_ENVELOPE_FRAME_MS)...(
      searchRange.upperBound / AUDIO_PROCESSING_ENVELOPE_FRAME_MS
    )
    guard let best = bestCorrelation(
      captureEnvelope: captureEnvelope,
      referenceEnvelope: referenceEnvelope,
      lagFrames: frameRange
    ) else {
      return AudioDelayDecision(
        delayMS: fixed,
        correlation: nil,
        searchBoundaryHit: false,
        usedFallback: true
      )
    }

    let delayMS = best.lagFrames * AUDIO_PROCESSING_ENVELOPE_FRAME_MS
    return AudioDelayDecision(
      delayMS: delayMS,
      correlation: best.correlation,
      searchBoundaryHit: delayMS == searchRange.lowerBound || delayMS == searchRange.upperBound,
      usedFallback: best.correlation < minimumCorrelation
    )
  }

  private static func bestCorrelation(
    captureEnvelope: [Float],
    referenceEnvelope: [Float],
    lagFrames: ClosedRange<Int>
  ) -> (lagFrames: Int, correlation: Double)? {
    guard captureEnvelope.count >= 10, referenceEnvelope.count >= 10 else { return nil }

    var best: (lagFrames: Int, correlation: Double)?
    for lag in lagFrames {
      let sampleCount = min(referenceEnvelope.count, captureEnvelope.count - lag)
      guard sampleCount >= 10 else { continue }
      var dot = 0.0
      var captureEnergy = 0.0
      var referenceEnergy = 0.0
      for index in 0..<sampleCount {
        let capture = Double(captureEnvelope[index + lag])
        let reference = Double(referenceEnvelope[index])
        dot += capture * reference
        captureEnergy += capture * capture
        referenceEnergy += reference * reference
      }
      guard captureEnergy > 1e-12, referenceEnergy > 1e-12 else { continue }
      let correlation = dot / sqrt(captureEnergy * referenceEnergy)
      guard correlation.isFinite else { continue }
      if best == nil || correlation > best!.correlation {
        best = (lag, correlation)
      }
    }
    return best
  }
}

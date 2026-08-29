// 生产录音的音频处理选项；默认关闭处理，启用时只允许明确的 WebRTC AEC3

import Foundation

public let AUDIO_PROCESSING_SAMPLE_RATE = 48_000
public let AUDIO_PROCESSING_FRAME_SAMPLES = 480
public let AUDIO_PROCESSING_ENVELOPE_FRAME_MS = 10
public let AUDIO_PROCESSING_MAX_DELAY_MS = 500

public enum AudioProcessorKind: String, Codable, CaseIterable, Sendable {
  case off
  case webrtcAec3
}

public enum AudioDelayMode: String, Codable, Sendable {
  case auto
  case fixed
  case hybrid
}

public enum AudioDownmixMode: String, Codable, Sendable {
  case average
  case first
}

public enum AudioNoiseSuppressionLevel: String, Codable, Sendable {
  case off
  case low
  case moderate
  case high
  case veryHigh = "very-high"
}

public enum AudioGainControlMode: String, Codable, Sendable {
  case off
  case agc1AdaptiveDigital = "agc1-adaptive-digital"
  case agc1Fixed = "agc1-fixed"
  case agc2
}

public struct AudioProcessingOptions: Codable, Equatable, Sendable {
  public var processor: AudioProcessorKind
  public var delayMode: AudioDelayMode
  public var fixedDelayMS: Int
  public var noiseSuppression: AudioNoiseSuppressionLevel
  public var gainControl: AudioGainControlMode
  public var highPass: Bool

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case processor
    case delayMode
    case fixedDelayMS = "fixedDelayMs"
    case noiseSuppression
    case gainControl
    case highPass
  }

  public init(
    processor: AudioProcessorKind = .off,
    delayMode: AudioDelayMode = .auto,
    fixedDelayMS: Int = 120,
    noiseSuppression: AudioNoiseSuppressionLevel = .moderate,
    gainControl: AudioGainControlMode = .off,
    highPass: Bool = true
  ) {
    self.processor = processor
    self.delayMode = delayMode
    self.fixedDelayMS = fixedDelayMS
    self.noiseSuppression = noiseSuppression
    self.gainControl = gainControl
    self.highPass = highPass
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let knownKeys = Set(CodingKeys.allCases.map(\.stringValue))
    let decodedKeys = Set(container.allKeys.map(\.stringValue))
    let unknownKeys = decodedKeys.subtracting(knownKeys)
    guard unknownKeys.isEmpty else {
      throw AudioProcessingConfigurationError.invalidValue(
        "unknown audioProcessing field(s): \(unknownKeys.sorted().joined(separator: ", "))"
      )
    }
    processor = try container.decodeIfPresent(AudioProcessorKind.self, forKey: .processor) ?? .off
    delayMode = try container.decodeIfPresent(AudioDelayMode.self, forKey: .delayMode) ?? .auto
    fixedDelayMS = try container.decodeIfPresent(Int.self, forKey: .fixedDelayMS) ?? 120
    noiseSuppression = try container.decodeIfPresent(
      AudioNoiseSuppressionLevel.self,
      forKey: .noiseSuppression
    ) ?? .moderate
    gainControl = try container.decodeIfPresent(
      AudioGainControlMode.self,
      forKey: .gainControl
    ) ?? .off
    highPass = try container.decodeIfPresent(Bool.self, forKey: .highPass) ?? true
  }

  public static let disabled = AudioProcessingOptions()

  /** 从 start 命令的 JSON 值解码；缺省值只在字段缺失时生效，未知字段直接拒绝。 */
  public static func decode(jsonValue: Any?) throws -> AudioProcessingOptions {
    guard let jsonValue else { return .disabled }
    guard let dictionary = jsonValue as? [String: Any] else {
      throw AudioProcessingConfigurationError.invalidValue(
        "audioProcessing must be a JSON object"
      )
    }

    let knownKeys: Set<String> = [
      "processor", "delayMode", "fixedDelayMs", "noiseSuppression", "gainControl", "highPass",
    ]
    let unknownKeys = Set(dictionary.keys).subtracting(knownKeys)
    guard unknownKeys.isEmpty else {
      throw AudioProcessingConfigurationError.invalidValue(
        "unknown audioProcessing field(s): \(unknownKeys.sorted().joined(separator: ", "))"
      )
    }

    do {
      let data = try JSONSerialization.data(withJSONObject: dictionary)
      let options = try JSONDecoder().decode(Self.self, from: data)
      try options.validate()
      return options
    }
    catch let error as AudioProcessingConfigurationError {
      throw error
    }
    catch {
      throw AudioProcessingConfigurationError.invalidValue(
        "cannot decode audioProcessing: \(error.localizedDescription)"
      )
    }
  }

  public func validate() throws {
    guard (0...AUDIO_PROCESSING_MAX_DELAY_MS).contains(fixedDelayMS) else {
      throw AudioProcessingConfigurationError.invalidValue(
        "fixedDelayMs must be between 0 and \(AUDIO_PROCESSING_MAX_DELAY_MS)"
      )
    }
  }
}

public enum AudioProcessingConfigurationError: Error, CustomStringConvertible, Equatable {
  case invalidValue(String)

  public var description: String {
    switch self {
    case .invalidValue(let detail): detail
    }
  }
}

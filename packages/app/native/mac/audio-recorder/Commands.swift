// 定义并解码 Electron 通过 stdin 发给 native recorder 的命令

import Foundation
import AudioProcessing

/** stdin NDJSON 命令的内部模型，只描述协议数据，不执行录音策略 */
enum RecorderCommand {
  case invalid(String)
  case start(StartOptions)
  case probeMic(ProbeMicOptions)
  case update(UpdateOptions)
  case pause
  case resume
  case stop(handoffId: Int?)

  struct StartOptions {
    let outputPath: String
    let engine: Engine
  }

  struct ProbeMicOptions {
  }

  enum Engine {
    case sck
    case tap(TapStartOptions)
  }

  struct TapStartOptions {
    let pids: [pid_t]
    let excludePids: [pid_t]
    let mic: Bool
    let tapEnabled: Bool
    let audioProcessing: AudioProcessingOptions
    let preferredMicStrategy: MicCaptureStrategy?
    let preferredMicDeviceKey: String?
  }

  struct UpdateOptions {
    let tapEnabled: Bool
    let micEnabled: Bool
    let pids: [pid_t]
    let excludePids: [pid_t]
  }
}

/**
 * 将一行 renderer/main 写入 stdin 的 JSON 转为录音命令
 *
 * 缺失字段使用当前协议默认值；未知 action、未知字段和畸形 JSON 明确返回 invalid
 */
enum RecorderCommandDecoder {
  static func decode(_ line: String) -> RecorderCommand? {
    guard let data = line.data(using: .utf8) else {
      return .invalid("command is not valid UTF-8")
    }

    let json: [String: Any]
    do {
      guard let decoded = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return .invalid("command must be a JSON object")
      }
      json = decoded
    }
    catch {
      return .invalid("malformed JSON: \(error)")
    }

    guard let action = json["action"] as? String else {
      return .invalid("command action must be a string")
    }

    do {
      switch action {
      case "start":
        try validateKeys(
          json,
          action: action,
          allowed: [
            "action", "outputPath", "engine", "pids", "excludePids", "mic", "tapEnabled",
            "audioProcessing", "preferredMicStrategy", "preferredMicDeviceKey",
          ]
        )
        return try decodeStart(json)
      case "probeMic":
        try validateKeys(json, action: action, allowed: ["action"])
        return .probeMic(.init())
      case "update":
        try validateKeys(
          json,
          action: action,
          allowed: ["action", "tapEnabled", "micEnabled", "pids", "excludePids"]
        )
        return .update(.init(
          tapEnabled: json["tapEnabled"] as? Bool ?? true,
          micEnabled: json["micEnabled"] as? Bool ?? true,
          pids: processIDs(json["pids"]),
          excludePids: processIDs(json["excludePids"])
        ))
      case "pause":
        try validateKeys(json, action: action, allowed: ["action"])
        return .pause
      case "resume":
        try validateKeys(json, action: action, allowed: ["action"])
        return .resume
      case "stop":
        try validateKeys(json, action: action, allowed: ["action", "handoffId"])
        return .stop(handoffId: (json["handoffId"] as? NSNumber)?.intValue)
      default:
        return .invalid("unsupported action: \(action)")
      }
    }
    catch {
      return .invalid(String(describing: error))
    }
  }

  private static func validateKeys(
    _ json: [String: Any],
    action: String,
    allowed: Set<String>
  ) throws {
    let unknown = Set(json.keys).subtracting(allowed).sorted()
    guard unknown.isEmpty else {
      throw RecorderCommandDecodingError.unknownFields(action: action, fields: unknown)
    }
  }

  private static func decodeStart(_ json: [String: Any]) throws -> RecorderCommand {
    let outputPath = json["outputPath"] as? String
      ?? "/tmp/audio-recording-\(Int(Date().timeIntervalSince1970)).m4a"

    guard json["engine"] as? String == "tap" else {
      return .start(.init(outputPath: outputPath, engine: .sck))
    }

    return .start(.init(
      outputPath: outputPath,
      engine: .tap(.init(
        pids: processIDs(json["pids"]),
        excludePids: processIDs(json["excludePids"]),
        mic: json["mic"] as? Bool ?? true,
        tapEnabled: json["tapEnabled"] as? Bool ?? true,
        audioProcessing: try decodeAudioProcessing(json["audioProcessing"]),
        preferredMicStrategy: (json["preferredMicStrategy"] as? String)
          .flatMap(MicCaptureStrategy.init(rawValue:)),
        preferredMicDeviceKey: json["preferredMicDeviceKey"] as? String
      ))
    ))
  }

  private static func decodeAudioProcessing(_ value: Any?) throws -> AudioProcessingOptions {
    try AudioProcessingOptions.decode(jsonValue: value)
  }

  private static func processIDs(_ value: Any?) -> [pid_t] {
    (value as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.int32Value }
  }
}

private enum RecorderCommandDecodingError: Error, CustomStringConvertible {
  case unknownFields(action: String, fields: [String])

  var description: String {
    switch self {
    case .unknownFields(let action, let fields):
      "unknown fields for \(action): \(fields.joined(separator: ", "))"
    }
  }
}

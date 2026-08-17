// 定义并解码 Electron 通过 stdin 发给 native recorder 的命令

import Foundation

/** stdin NDJSON 命令的内部模型，只描述协议数据，不执行录音策略 */
enum RecorderCommand {
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
    let micAec: Bool
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
    let micAec: Bool
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
 * 保留旧协议的宽松边界：畸形 JSON、未知 action 静默忽略，缺失字段使用既有默认值
 */
enum RecorderCommandDecoder {
  static func decode(_ line: String) -> RecorderCommand? {
    guard let data = line.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let action = json["action"] as? String
    else { return nil }

    switch action {
    case "start":
      return decodeStart(json)
    case "probeMic":
      return .probeMic(.init(micAec: json["micAec"] as? Bool ?? true))
    case "update":
      return .update(.init(
        tapEnabled: json["tapEnabled"] as? Bool ?? true,
        micEnabled: json["micEnabled"] as? Bool ?? true,
        pids: processIDs(json["pids"]),
        excludePids: processIDs(json["excludePids"])
      ))
    case "pause":
      return .pause
    case "resume":
      return .resume
    case "stop":
      return .stop(handoffId: (json["handoffId"] as? NSNumber)?.intValue)
    default:
      return nil
    }
  }

  private static func decodeStart(_ json: [String: Any]) -> RecorderCommand {
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
        micAec: json["micAec"] as? Bool ?? true,
        preferredMicStrategy: (json["preferredMicStrategy"] as? String)
          .flatMap(MicCaptureStrategy.init(rawValue:)),
        preferredMicDeviceKey: json["preferredMicDeviceKey"] as? String
      ))
    ))
  }

  private static func processIDs(_ value: Any?) -> [pid_t] {
    (value as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.int32Value }
  }
}

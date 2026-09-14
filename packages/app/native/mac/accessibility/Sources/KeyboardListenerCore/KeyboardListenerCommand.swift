import Foundation

/// 主进程经 stdin 下发给 helper 的命令：一行一个 JSON，协议版本与上行事件共用
public enum KeyboardListenerCommand: Equatable, Sendable {
  /// 是否在 tap 层拦下 🌐 键动作（keyCode 0xB3 的 keyDown / keyUp）
  case config(suppressGlobeKey: Bool)
}

/// 解析一行下行命令；字段集合必须精确匹配，多字段少字段都拒绝，
/// 与 TypeScript 侧解码上行事件的口径一致，避免两端版本错配时把半截协议当成有效命令
public struct KeyboardListenerCommandDecoder: Sendable {
  public static let protocolVersion = KeyboardListenerEventEncoder.protocolVersion

  public init() {}

  public func decode(_ line: Data) -> KeyboardListenerCommand? {
    guard let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { return nil }
    guard object["v"] as? Int == Self.protocolVersion, object["type"] as? String == "config" else { return nil }
    guard Set(object.keys) == ["v", "type", "suppressGlobeKey"] else { return nil }
    guard let suppressGlobeKey = object["suppressGlobeKey"] as? Bool else { return nil }

    return .config(suppressGlobeKey: suppressGlobeKey)
  }

  public func decode(_ line: String) -> KeyboardListenerCommand? {
    decode(Data(line.utf8))
  }
}

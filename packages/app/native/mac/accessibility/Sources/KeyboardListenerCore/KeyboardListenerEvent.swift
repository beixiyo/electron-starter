import Foundation

/// helper 输出的原始物理输入事件，不包含任何 chord 或手势语义
public enum KeyboardListenerEvent: Equatable, Sendable {
  case input(KeyboardListenerInputEvent)
  case reset(timestamp: UInt64)
}

/// 一次物理按键的 down/up；`fn` 表示该键属于 Fn 组合
public struct KeyboardListenerInputEvent: Equatable, Sendable {
  public let phase: KeyboardInputPhase
  public let key: String
  public let modifiers: [KeyboardModifier]
  public let fn: Bool
  public let timestamp: UInt64

  public init(
    phase: KeyboardInputPhase,
    key: String,
    modifiers: [KeyboardModifier],
    fn: Bool,
    timestamp: UInt64
  ) {
    self.phase = phase
    self.key = key
    self.modifiers = modifiers
    self.fn = fn
    self.timestamp = timestamp
  }
}

public enum KeyboardInputPhase: String, Equatable, Sendable {
  case down
  case up
}

/// 逻辑修饰键，与 TypeScript 侧 `FnModifier` 一一对应
public enum KeyboardModifier: String, Codable, CaseIterable, Equatable, Sendable {
  case control = "Control"
  case alt = "Alt"
  case shift = "Shift"
  case meta = "Meta"
}

/// 将事件编码为单行 NDJSON，协议版本 2
public struct KeyboardListenerEventEncoder: Sendable {
  public static let protocolVersion = 2

  private let encoder: JSONEncoder

  public init() {
    encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
  }

  public func encode(_ event: KeyboardListenerEvent) throws -> String {
    let payload: Payload
    switch event {
      case let .input(input):
        payload = Payload(
          type: "input",
          phase: input.phase.rawValue,
          key: input.key,
          modifiers: input.modifiers.map(\.rawValue),
          fn: input.fn,
          timestamp: input.timestamp
        )
      case let .reset(timestamp):
        payload = Payload(type: "reset", timestamp: timestamp)
    }

    return String(decoding: try encoder.encode(payload), as: UTF8.self)
  }
}

private struct Payload: Encodable {
  let v = KeyboardListenerEventEncoder.protocolVersion
  let type: String
  let phase: String?
  let key: String?
  let modifiers: [String]?
  let fn: Bool?
  let timestamp: UInt64

  init(
    type: String,
    phase: String? = nil,
    key: String? = nil,
    modifiers: [String]? = nil,
    fn: Bool? = nil,
    timestamp: UInt64
  ) {
    self.type = type
    self.phase = phase
    self.key = key
    self.modifiers = modifiers
    self.fn = fn
    self.timestamp = timestamp
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(v, forKey: .v)
    try container.encode(type, forKey: .type)
    try container.encode(timestamp, forKey: .timestamp)
    try container.encodeIfPresent(phase, forKey: .phase)
    try container.encodeIfPresent(key, forKey: .key)
    try container.encodeIfPresent(modifiers, forKey: .modifiers)
    try container.encodeIfPresent(fn, forKey: .fn)
  }

  private enum CodingKeys: String, CodingKey {
    case v
    case type
    case phase
    case key
    case modifiers
    case fn
    case timestamp
  }
}

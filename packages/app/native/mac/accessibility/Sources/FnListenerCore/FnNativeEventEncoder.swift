import Foundation

/// 将原始物理事件编码为单行 NDJSON
public struct FnNativeEventEncoder: Sendable {
  private let encoder: JSONEncoder

  public init() {
    encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
  }

  public func encode(_ event: FnNativeEvent) throws -> String {
    let payload: Payload
    switch event {
      case let .input(input):
        payload = Payload(
          v: 1,
          type: "input",
          phase: input.phase.rawValue,
          sequence: input.sequence,
          timestamp: input.timestamp,
          key: input.key,
          modifiers: input.modifiers.map(\.rawValue)
        )
      case let .reset(timestamp):
        payload = Payload(v: 1, type: "reset", timestamp: timestamp)
    }

    return String(decoding: try encoder.encode(payload), as: UTF8.self)
  }
}

private struct Payload: Encodable {
  let v: Int
  let type: String
  let phase: String?
  let sequence: UInt64?
  let timestamp: UInt64
  let key: String?
  let modifiers: [String]?

  init(
    v: Int,
    type: String,
    phase: String? = nil,
    sequence: UInt64? = nil,
    timestamp: UInt64,
    key: String? = nil,
    modifiers: [String]? = nil
  ) {
    self.v = v
    self.type = type
    self.phase = phase
    self.sequence = sequence
    self.timestamp = timestamp
    self.key = key
    self.modifiers = modifiers
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(v, forKey: .v)
    try container.encode(type, forKey: .type)
    try container.encode(timestamp, forKey: .timestamp)
    try container.encodeIfPresent(phase, forKey: .phase)
    try container.encodeIfPresent(sequence, forKey: .sequence)
    try container.encodeIfPresent(key, forKey: .key)
    try container.encodeIfPresent(modifiers, forKey: .modifiers)
  }

  private enum CodingKeys: String, CodingKey {
    case v
    case type
    case phase
    case sequence
    case timestamp
    case key
    case modifiers
  }
}

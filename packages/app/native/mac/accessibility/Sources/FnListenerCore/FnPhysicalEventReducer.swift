import Foundation

/// Fn helper 输出的原始物理输入事件，不包含任何快捷键手势语义
public enum FnNativeEvent: Equatable, Sendable {
  case input(FnNativeInputEvent)
  case reset(timestamp: UInt64)
}

/// 一次 Fn 或 Fn 组合键的物理 down/up
public struct FnNativeInputEvent: Equatable, Sendable {
  public let phase: FnInputPhase
  public let sequence: UInt64
  public let timestamp: UInt64
  public let key: String
  public let modifiers: [FnModifier]

  public init(
    phase: FnInputPhase,
    sequence: UInt64,
    timestamp: UInt64,
    key: String,
    modifiers: [FnModifier]
  ) {
    self.phase = phase
    self.sequence = sequence
    self.timestamp = timestamp
    self.key = key
    self.modifiers = modifiers
  }
}

public enum FnInputPhase: String, Equatable, Sendable {
  case down
  case up
}

public enum FnModifier: String, Codable, CaseIterable, Equatable, Sendable {
  case control = "Control"
  case alt = "Alt"
  case shift = "Shift"
  case meta = "Meta"
}

/// 将 CGEvent 虚拟键码映射为协议键名
public let fnComboKeys: [Int64: String] = [
  0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X", 8: "C", 9: "V",
  11: "B", 12: "Q", 13: "W", 14: "E", 15: "R", 16: "Y", 17: "T",
  31: "O", 32: "U", 34: "I", 35: "P", 37: "L", 38: "J", 40: "K", 45: "N", 46: "M",
  18: "1", 19: "2", 20: "3", 21: "4", 23: "5", 22: "6", 26: "7", 28: "8", 25: "9", 29: "0",
  36: "Enter", 53: "Escape", 51: "Backspace", 48: "Tab", 49: "Space",
  27: "Minus", 24: "Equal", 33: "LeftBracket", 30: "RightBracket",
  42: "Backslash", 41: "Semicolon", 39: "Quote", 50: "Grave",
  43: "Comma", 47: "Period", 44: "Slash",
  115: "Home", 119: "End", 116: "PageUp", 121: "PageDown", 117: "Delete",
  123: "Left", 124: "Right", 125: "Down", 126: "Up",
  122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6",
  98: "F7", 100: "F8", 101: "F9", 109: "F10", 103: "F11", 111: "F12",
]

/// 只维护物理按压配对和冻结 chord，不判断 press、doublePress 或 hold
public struct FnPhysicalEventReducer: Sendable {
  private var nextSequence: UInt64 = 0
  private var activeFn: ActiveChord?
  private var activeCombos: [Int64: ActiveChord] = [:]
  private var comboOrder: [Int64] = []

  public init() {}

  public var isFnDown: Bool { activeFn != nil }

  public mutating func handleFnDown(timestamp: UInt64) -> [FnNativeEvent] {
    guard activeFn == nil else { return [] }

    let chord = makeChord(key: "Fn", modifiers: [])
    activeFn = chord
    return [.input(chord.event(phase: .down, timestamp: timestamp))]
  }

  public mutating func handleFnUp(timestamp: UInt64) -> [FnNativeEvent] {
    guard let fn = activeFn else { return [] }

    var events = comboOrder.compactMap { keyCode -> FnNativeEvent? in
      guard let chord = activeCombos[keyCode] else { return nil }
      return .input(chord.event(phase: .up, timestamp: timestamp))
    }
    events.append(.input(fn.event(phase: .up, timestamp: timestamp)))

    activeCombos.removeAll()
    comboOrder.removeAll()
    activeFn = nil
    return events
  }

  public mutating func handleKeyDown(
    keyCode: Int64,
    modifiers: [FnModifier],
    timestamp: UInt64,
    belongsToFnChord: Bool,
    isAutorepeat: Bool
  ) -> [FnNativeEvent] {
    guard activeFn != nil, belongsToFnChord, !isAutorepeat else { return [] }
    guard activeCombos[keyCode] == nil, let key = fnComboKeys[keyCode] else { return [] }

    let chord = makeChord(key: key, modifiers: modifiers)
    activeCombos[keyCode] = chord
    comboOrder.append(keyCode)
    return [.input(chord.event(phase: .down, timestamp: timestamp))]
  }

  public mutating func handleKeyUp(keyCode: Int64, timestamp: UInt64) -> [FnNativeEvent] {
    guard let chord = activeCombos.removeValue(forKey: keyCode) else { return [] }
    comboOrder.removeAll { $0 == keyCode }
    return [.input(chord.event(phase: .up, timestamp: timestamp))]
  }

  public mutating func reset(timestamp: UInt64) -> [FnNativeEvent] {
    activeFn = nil
    activeCombos.removeAll()
    comboOrder.removeAll()
    return [.reset(timestamp: timestamp)]
  }

  private mutating func makeChord(key: String, modifiers: [FnModifier]) -> ActiveChord {
    nextSequence &+= 1
    return ActiveChord(sequence: nextSequence, key: key, modifiers: modifiers)
  }
}

private struct ActiveChord: Sendable {
  let sequence: UInt64
  let key: String
  let modifiers: [FnModifier]

  func event(phase: FnInputPhase, timestamp: UInt64) -> FnNativeInputEvent {
    FnNativeInputEvent(
      phase: phase,
      sequence: sequence,
      timestamp: timestamp,
      key: key,
      modifiers: modifiers
    )
  }
}

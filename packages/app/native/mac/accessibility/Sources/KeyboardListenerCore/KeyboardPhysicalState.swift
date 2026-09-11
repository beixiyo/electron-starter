/// 物理按键状态：去重、修饰键 down/up 判定与 Fn 组合归属，不判断任何手势
public struct KeyboardPhysicalState: Sendable {
  /// Fn 按下后这段时间内收到的按键即便没带 fn flag 也视为 Fn 组合，
  /// 兼容部分键盘 fn flag 晚于 keyDown 到达的情况
  public static let fnComboWindowMilliseconds: UInt64 = 600

  private var pressedKeyCodes: Set<Int64> = []
  private var fnClassifier = FnPhysicalInputClassifier()
  private var fnDown = false
  private var fnDownAt: UInt64 = 0

  public init() {}

  public var isFnDown: Bool { fnDown }

  /// Fn 的 flagsChanged 边界
  public mutating func handleFnFlag(hasFnFlag: Bool, timestamp: UInt64) -> KeyboardListenerEvent? {
    guard let phase = fnClassifier.classify(hasFnFlag: hasFnFlag, isFnDown: fnDown) else { return nil }

    fnDown = phase == .down
    fnDownAt = phase == .down ? timestamp : 0
    return .input(KeyboardListenerInputEvent(
      phase: phase,
      key: "Fn",
      modifiers: [],
      fn: false,
      timestamp: timestamp
    ))
  }

  /// 普通键 keyDown；系统自动重复与重复按下返回 nil
  public mutating func handleKeyDown(
    keyCode: Int64,
    modifiers: [KeyboardModifier],
    hasFnFlag: Bool,
    isAutorepeat: Bool,
    timestamp: UInt64
  ) -> KeyboardListenerEvent? {
    guard !isAutorepeat, let key = macKeyboardCodes[keyCode] else { return nil }
    guard pressedKeyCodes.insert(keyCode).inserted else { return nil }

    return .input(KeyboardListenerInputEvent(
      phase: .down,
      key: key,
      modifiers: modifiers,
      fn: belongsToFnChord(hasFnFlag: hasFnFlag, timestamp: timestamp),
      timestamp: timestamp
    ))
  }

  /// 普通键 keyUp；没有对应 down 的 up 返回 nil
  public mutating func handleKeyUp(
    keyCode: Int64,
    modifiers: [KeyboardModifier],
    hasFnFlag: Bool,
    timestamp: UInt64
  ) -> KeyboardListenerEvent? {
    guard pressedKeyCodes.remove(keyCode) != nil, let key = macKeyboardCodes[keyCode] else { return nil }

    return .input(KeyboardListenerInputEvent(
      phase: .up,
      key: key,
      modifiers: modifiers,
      fn: belongsToFnChord(hasFnFlag: hasFnFlag, timestamp: timestamp),
      timestamp: timestamp
    ))
  }

  /// 修饰键的 flagsChanged：同一键码交替视为 down/up；左右同时按住时靠键码区分，
  /// 家族 flag 只用来拒绝没有对应 down 的陈旧 release
  public mutating func handleModifierKey(
    keyCode: Int64,
    familyFlagSet: Bool,
    modifiers: [KeyboardModifier],
    hasFnFlag: Bool,
    timestamp: UInt64
  ) -> KeyboardListenerEvent? {
    guard let key = macKeyboardCodes[keyCode] else { return nil }

    let phase: KeyboardInputPhase
    if pressedKeyCodes.contains(keyCode) {
      pressedKeyCodes.remove(keyCode)
      phase = .up
    }
    else if familyFlagSet {
      pressedKeyCodes.insert(keyCode)
      phase = .down
    }
    else {
      return nil
    }

    return .input(KeyboardListenerInputEvent(
      phase: phase,
      key: key,
      modifiers: modifiers,
      fn: belongsToFnChord(hasFnFlag: hasFnFlag, timestamp: timestamp),
      timestamp: timestamp
    ))
  }

  /// tap 被系统禁用或 helper 重启：清空全部物理状态并通知消费方
  public mutating func reset(timestamp: UInt64) -> KeyboardListenerEvent {
    pressedKeyCodes.removeAll()
    fnDown = false
    fnDownAt = 0
    return .reset(timestamp: timestamp)
  }

  private func belongsToFnChord(hasFnFlag: Bool, timestamp: UInt64) -> Bool {
    guard fnDown else { return false }
    return hasFnFlag || timestamp &- fnDownAt < Self.fnComboWindowMilliseconds
  }
}

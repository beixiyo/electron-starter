/// 只接受 maskSecondaryFn 确认的 Fn down，无 flag 事件只能结束已确认的 down
public struct FnPhysicalInputClassifier: Sendable {
  public init() {}

  public func classify(
    hasFnFlag: Bool,
    isFnDown: Bool
  ) -> FnPhysicalPhase? {
    if hasFnFlag {
      return isFnDown ? nil : .down
    }

    return isFnDown ? .up : nil
  }
}

public enum FnPhysicalPhase: Equatable, Sendable {
  case down
  case up
}

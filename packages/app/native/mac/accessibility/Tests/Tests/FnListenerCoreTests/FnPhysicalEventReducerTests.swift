import FnListenerCore
import Testing

@Test("Fn down/up 共享 sequence")
func fnDownUp共享Sequence() {
  var reducer = FnPhysicalEventReducer()
  #expect(reducer.handleFnDown(timestamp: 10) == [.input(input(.down, 1, 10, "Fn"))])
  #expect(reducer.handleFnDown(timestamp: 11).isEmpty)
  #expect(reducer.handleFnUp(timestamp: 20) == [.input(input(.up, 1, 20, "Fn"))])
  #expect(reducer.handleFnUp(timestamp: 21).isEmpty)
}

@Test("Fn+Space down/up 形成独立物理 chord")
func fnSpaceDownUp形成独立物理Chord() {
  var reducer = FnPhysicalEventReducer()
  _ = reducer.handleFnDown(timestamp: 10)

  let down = reducer.handleKeyDown(
    keyCode: 49,
    modifiers: [.meta],
    timestamp: 11,
    belongsToFnChord: true,
    isAutorepeat: false
  )
  let up = reducer.handleKeyUp(keyCode: 49, timestamp: 12)

  #expect(down == [.input(input(.down, 2, 11, "Space", [.meta]))])
  #expect(up == [.input(input(.up, 2, 12, "Space", [.meta]))])
}

@Test("普通键先松开再松 Fn")
func 普通键先松开再松Fn() {
  var reducer = FnPhysicalEventReducer()
  _ = reducer.handleFnDown(timestamp: 1)
  _ = reducer.handleKeyDown(
    keyCode: 49,
    modifiers: [],
    timestamp: 2,
    belongsToFnChord: true,
    isAutorepeat: false
  )

  #expect(reducer.handleKeyUp(keyCode: 49, timestamp: 3) == [.input(input(.up, 2, 3, "Space"))])
  #expect(reducer.handleFnUp(timestamp: 4) == [.input(input(.up, 1, 4, "Fn"))])
}

@Test("Fn 先松开时按 down 顺序补齐 combo up")
func fn先松开时按Down顺序补齐ComboUp() {
  var reducer = FnPhysicalEventReducer()
  _ = reducer.handleFnDown(timestamp: 1)
  _ = reducer.handleKeyDown(
    keyCode: 49,
    modifiers: [],
    timestamp: 2,
    belongsToFnChord: true,
    isAutorepeat: false
  )
  _ = reducer.handleKeyDown(
    keyCode: 0,
    modifiers: [.shift],
    timestamp: 3,
    belongsToFnChord: true,
    isAutorepeat: false
  )

  #expect(reducer.handleFnUp(timestamp: 4) == [
    .input(input(.up, 2, 4, "Space")),
    .input(input(.up, 3, 4, "A", [.shift])),
    .input(input(.up, 1, 4, "Fn")),
  ])
  #expect(reducer.handleKeyUp(keyCode: 49, timestamp: 5).isEmpty)
}

@Test("autorepeat 和重复 down/up 被忽略")
func autorepeat和重复DownUp被忽略() {
  var reducer = FnPhysicalEventReducer()
  _ = reducer.handleFnDown(timestamp: 1)
  let first = reducer.handleKeyDown(
    keyCode: 49,
    modifiers: [],
    timestamp: 2,
    belongsToFnChord: true,
    isAutorepeat: false
  )

  #expect(first.count == 1)
  #expect(reducer.handleKeyDown(
    keyCode: 49,
    modifiers: [],
    timestamp: 3,
    belongsToFnChord: true,
    isAutorepeat: true
  ).isEmpty)
  #expect(reducer.handleKeyDown(
    keyCode: 49,
    modifiers: [],
    timestamp: 4,
    belongsToFnChord: true,
    isAutorepeat: false
  ).isEmpty)
  #expect(reducer.handleKeyUp(keyCode: 49, timestamp: 5).count == 1)
  #expect(reducer.handleKeyUp(keyCode: 49, timestamp: 6).isEmpty)
}

@Test("up 复用 down 时冻结的 modifiers")
func up复用Down时冻结的Modifiers() {
  var reducer = FnPhysicalEventReducer()
  _ = reducer.handleFnDown(timestamp: 1)
  _ = reducer.handleKeyDown(
    keyCode: 49,
    modifiers: [.control, .meta],
    timestamp: 2,
    belongsToFnChord: true,
    isAutorepeat: false
  )

  #expect(reducer.handleKeyUp(keyCode: 49, timestamp: 3) == [
    .input(input(.up, 2, 3, "Space", [.control, .meta])),
  ])
}

@Test("reset 清除 active chord 且旧 keyUp 被忽略")
func reset清除状态且旧KeyUp被忽略() {
  var reducer = FnPhysicalEventReducer()
  _ = reducer.handleFnDown(timestamp: 1)
  _ = reducer.handleKeyDown(
    keyCode: 49,
    modifiers: [],
    timestamp: 2,
    belongsToFnChord: true,
    isAutorepeat: false
  )

  #expect(reducer.reset(timestamp: 3) == [.reset(timestamp: 3)])
  #expect(!reducer.isFnDown)
  #expect(reducer.handleKeyUp(keyCode: 49, timestamp: 4).isEmpty)
  #expect(reducer.handleFnUp(timestamp: 5).isEmpty)
}

@Test("不支持的 key 不产生 combo 且 sequence 保持唯一")
func 不支持的Key不产生Combo且Sequence保持唯一() {
  var reducer = FnPhysicalEventReducer()
  _ = reducer.handleFnDown(timestamp: 1)
  #expect(reducer.handleKeyDown(
    keyCode: 999,
    modifiers: [],
    timestamp: 2,
    belongsToFnChord: true,
    isAutorepeat: false
  ).isEmpty)
  _ = reducer.handleFnUp(timestamp: 3)

  #expect(reducer.handleFnDown(timestamp: 4) == [.input(input(.down, 2, 4, "Fn"))])
}

private func input(
  _ phase: FnInputPhase,
  _ sequence: UInt64,
  _ timestamp: UInt64,
  _ key: String,
  _ modifiers: [FnModifier] = []
) -> FnNativeInputEvent {
  FnNativeInputEvent(
    phase: phase,
    sequence: sequence,
    timestamp: timestamp,
    key: key,
    modifiers: modifiers
  )
}

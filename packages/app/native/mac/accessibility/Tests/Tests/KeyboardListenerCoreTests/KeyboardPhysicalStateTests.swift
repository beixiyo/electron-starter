import KeyboardListenerCore
import Testing

@Test("Fn down/up 只在 flag 边界各输出一次")
func fnDownUp只在Flag边界各输出一次() {
  var state = KeyboardPhysicalState()
  #expect(state.handleFnFlag(hasFnFlag: true, timestamp: 10) == .input(input(.down, "Fn", timestamp: 10)))
  #expect(state.handleFnFlag(hasFnFlag: true, timestamp: 11) == nil)
  #expect(state.handleFnFlag(hasFnFlag: false, timestamp: 20) == .input(input(.up, "Fn", timestamp: 20)))
  #expect(state.handleFnFlag(hasFnFlag: false, timestamp: 21) == nil)
}

@Test("Fn 按住期间带 flag 的普通键标记为 Fn 组合，Fn 松开后不再标记")
func fn按住期间带Flag的普通键标记为Fn组合() {
  var state = KeyboardPhysicalState()
  _ = state.handleFnFlag(hasFnFlag: true, timestamp: 10)

  let down = state.handleKeyDown(keyCode: 0x31, modifiers: [.meta], hasFnFlag: true, isAutorepeat: false, timestamp: 11)
  #expect(down == .input(input(.down, "Space", modifiers: [.meta], fn: true, timestamp: 11)))

  _ = state.handleKeyUp(keyCode: 0x31, modifiers: [.meta], hasFnFlag: true, timestamp: 12)
  _ = state.handleFnFlag(hasFnFlag: false, timestamp: 13)

  let plain = state.handleKeyDown(keyCode: 0x31, modifiers: [], hasFnFlag: false, isAutorepeat: false, timestamp: 2_000)
  #expect(plain == .input(input(.down, "Space", timestamp: 2_000)))
}

@Test("Fn 按下后 600ms 内没带 flag 的按键仍视为 Fn 组合")
func fn按下后窗口内没带Flag的按键仍视为Fn组合() {
  var state = KeyboardPhysicalState()
  _ = state.handleFnFlag(hasFnFlag: true, timestamp: 100)

  let within = state.handleKeyDown(keyCode: 0x01, modifiers: [], hasFnFlag: false, isAutorepeat: false, timestamp: 600)
  #expect(within == .input(input(.down, "S", fn: true, timestamp: 600)))

  _ = state.handleKeyUp(keyCode: 0x01, modifiers: [], hasFnFlag: false, timestamp: 601)
  let late = state.handleKeyDown(keyCode: 0x01, modifiers: [], hasFnFlag: false, isAutorepeat: false, timestamp: 800)
  #expect(late == .input(input(.down, "S", timestamp: 800)))
}

@Test("自动重复与重复按下被丢弃，没有 down 的 up 也被丢弃")
func 自动重复与重复按下被丢弃() {
  var state = KeyboardPhysicalState()
  #expect(state.handleKeyDown(keyCode: 0x00, modifiers: [], hasFnFlag: false, isAutorepeat: true, timestamp: 1) == nil)
  #expect(state.handleKeyUp(keyCode: 0x00, modifiers: [], hasFnFlag: false, timestamp: 2) == nil)

  #expect(state.handleKeyDown(keyCode: 0x00, modifiers: [], hasFnFlag: false, isAutorepeat: false, timestamp: 3) != nil)
  #expect(state.handleKeyDown(keyCode: 0x00, modifiers: [], hasFnFlag: false, isAutorepeat: false, timestamp: 4) == nil)
  #expect(state.handleKeyUp(keyCode: 0x00, modifiers: [], hasFnFlag: false, timestamp: 5) == .input(input(.up, "A", timestamp: 5)))
}

@Test("左右修饰键各自按键码判定 down/up，家族 flag 仍置位时先松开的一侧也能上报 up")
func 左右修饰键各自按键码判定() {
  var state = KeyboardPhysicalState()

  let leftDown = state.handleModifierKey(keyCode: 0x38, familyFlagSet: true, modifiers: [.shift], hasFnFlag: false, timestamp: 1)
  #expect(leftDown == .input(input(.down, "ShiftLeft", modifiers: [.shift], timestamp: 1)))

  let rightDown = state.handleModifierKey(keyCode: 0x3C, familyFlagSet: true, modifiers: [.shift], hasFnFlag: false, timestamp: 2)
  #expect(rightDown == .input(input(.down, "ShiftRight", modifiers: [.shift], timestamp: 2)))

  let leftUp = state.handleModifierKey(keyCode: 0x38, familyFlagSet: true, modifiers: [.shift], hasFnFlag: false, timestamp: 3)
  #expect(leftUp == .input(input(.up, "ShiftLeft", modifiers: [.shift], timestamp: 3)))

  let rightUp = state.handleModifierKey(keyCode: 0x3C, familyFlagSet: false, modifiers: [], hasFnFlag: false, timestamp: 4)
  #expect(rightUp == .input(input(.up, "ShiftRight", timestamp: 4)))
}

@Test("没有对应 down 的修饰键 release 被忽略")
func 没有对应Down的修饰键Release被忽略() {
  var state = KeyboardPhysicalState()
  #expect(state.handleModifierKey(keyCode: 0x37, familyFlagSet: false, modifiers: [], hasFnFlag: false, timestamp: 1) == nil)
}

@Test("reset 清空全部物理状态")
func reset清空全部物理状态() {
  var state = KeyboardPhysicalState()
  _ = state.handleFnFlag(hasFnFlag: true, timestamp: 1)
  _ = state.handleKeyDown(keyCode: 0x00, modifiers: [], hasFnFlag: true, isAutorepeat: false, timestamp: 2)

  #expect(state.reset(timestamp: 3) == .reset(timestamp: 3))
  #expect(state.isFnDown == false)
  #expect(state.handleKeyUp(keyCode: 0x00, modifiers: [], hasFnFlag: false, timestamp: 4) == nil)
  #expect(state.handleKeyDown(keyCode: 0x00, modifiers: [], hasFnFlag: false, isAutorepeat: false, timestamp: 5) == .input(input(.down, "A", timestamp: 5)))
}

@Test("表外键码被丢弃")
func 表外键码被丢弃() {
  var state = KeyboardPhysicalState()
  #expect(state.handleKeyDown(keyCode: 0x0A, modifiers: [], hasFnFlag: false, isAutorepeat: false, timestamp: 1) == nil)
}

private func input(
  _ phase: KeyboardInputPhase,
  _ key: String,
  modifiers: [KeyboardModifier] = [],
  fn: Bool = false,
  timestamp: UInt64
) -> KeyboardListenerInputEvent {
  KeyboardListenerInputEvent(phase: phase, key: key, modifiers: modifiers, fn: fn, timestamp: timestamp)
}

import Cocoa
import CoreGraphics
import KeyboardListenerCore

// 全键盘原始物理输入监听器：输出每个按键（含 Fn/Globe 与左右侧修饰键）的 down/up/reset，
// 不判断 chord、press、doublePress、hold 或任何 action/scope 语义

var state = KeyboardPhysicalState()
let eventEncoder = KeyboardListenerEventEncoder()
var eventTap: CFMachPort?

func monotonicMilliseconds() -> UInt64 {
  UInt64(ProcessInfo.processInfo.systemUptime * 1_000)
}

func output(_ message: String) {
  print(message)
  if fflush(stdout) != 0 {
    exit(0)
  }
}

func output(_ event: KeyboardListenerEvent?) {
  guard let event else { return }
  do {
    output(try eventEncoder.encode(event))
  }
  catch {
    fputs("KEYBOARD_EVENT_ENCODE_FAILED\n", stderr)
    exit(1)
  }
}

func isAccessibilityTrusted(prompt: Bool) -> Bool {
  let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
  return AXIsProcessTrustedWithOptions([key: prompt] as CFDictionary)
}

func modifiers(from event: CGEvent) -> [KeyboardModifier] {
  var modifiers: [KeyboardModifier] = []
  let flags = event.flags
  if flags.contains(.maskControl) { modifiers.append(.control) }
  if flags.contains(.maskAlternate) { modifiers.append(.alt) }
  if flags.contains(.maskShift) { modifiers.append(.shift) }
  if flags.contains(.maskCommand) { modifiers.append(.meta) }
  return modifiers
}

func familyFlag(of modifier: KeyboardModifier) -> CGEventFlags {
  switch modifier {
    case .control: .maskControl
    case .alt: .maskAlternate
    case .shift: .maskShift
    case .meta: .maskCommand
  }
}

if CommandLine.arguments.contains("--check-accessibility") {
  if isAccessibilityTrusted(prompt: false) {
    output("ACCESSIBILITY_TRUSTED")
    exit(0)
  }

  fputs("ACCESSIBILITY_NOT_TRUSTED\n", stderr)
  exit(1)
}

if CommandLine.arguments.contains("--prompt-accessibility") {
  if isAccessibilityTrusted(prompt: true) {
    output("ACCESSIBILITY_TRUSTED")
    exit(0)
  }

  fputs("ACCESSIBILITY_NOT_TRUSTED\n", stderr)
  exit(1)
}

let callback: CGEventTapCallBack = { _, type, event, _ in
  let timestamp = monotonicMilliseconds()

  if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
    output(state.reset(timestamp: timestamp))
    if let tap = eventTap {
      CGEvent.tapEnable(tap: tap, enable: true)
    }
    return Unmanaged.passUnretained(event)
  }

  let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
  let hasFnFlag = event.flags.contains(.maskSecondaryFn)

  // @TODO 这里原样放行 fn 事件，macOS 系统设置里「按下🌐键时」的原生动作会与上层的 Fn 手势同时触发
  //
  // 实测：该项设为「显示表情与符号」时单击 Fn，系统表情面板会和上层的单击手势一起响应；
  // 设为「开始听写（连按两下）」时，双击 Fn 会和上层的双击手势撞车
  // tap 建的是 .defaultTap（主动 tap，具备抑制能力），理论上判定为纯单击时 return nil 就能拦下，
  // 难点是必须在事件当场决定吞不吞，且吞掉 up 会让下游 fn flag 状态与实际不符，
  // 可能波及 Fn+F1~F12、fn+方向键、fn+Delete，需先单独做技术验证
  // 在此之前只能靠引导用户把「按下🌐键时」改成「不执行任何操作」来规避
  switch type {
    case .flagsChanged:
      if keyCode == fnKeyCode {
        output(state.handleFnFlag(hasFnFlag: hasFnFlag, timestamp: timestamp))
      }
      else if let family = macModifierKeyCodes[keyCode] {
        output(state.handleModifierKey(
          keyCode: keyCode,
          familyFlagSet: event.flags.contains(familyFlag(of: family)),
          modifiers: modifiers(from: event),
          hasFnFlag: hasFnFlag,
          timestamp: timestamp
        ))
      }
    case .keyDown:
      output(state.handleKeyDown(
        keyCode: keyCode,
        modifiers: modifiers(from: event),
        hasFnFlag: hasFnFlag,
        isAutorepeat: event.getIntegerValueField(.keyboardEventAutorepeat) != 0,
        timestamp: timestamp
      ))
    case .keyUp:
      output(state.handleKeyUp(
        keyCode: keyCode,
        modifiers: modifiers(from: event),
        hasFnFlag: hasFnFlag,
        timestamp: timestamp
      ))
    default:
      break
  }

  return Unmanaged.passUnretained(event)
}

if !isAccessibilityTrusted(prompt: false) {
  fputs("ACCESSIBILITY_NOT_TRUSTED\n", stderr)
  exit(1)
}

let mask = (1 << CGEventType.flagsChanged.rawValue)
  | (1 << CGEventType.keyDown.rawValue)
  | (1 << CGEventType.keyUp.rawValue)

guard let tap = CGEvent.tapCreate(
  tap: .cghidEventTap,
  place: .headInsertEventTap,
  options: .defaultTap,
  eventsOfInterest: CGEventMask(mask),
  callback: callback,
  userInfo: nil
) else {
  fputs("TAP_CREATE_FAILED\n", stderr)
  exit(1)
}

eventTap = tap
let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

signal(SIGPIPE, SIG_IGN)

let parentCheckTimer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
parentCheckTimer.schedule(deadline: .now() + 5, repeating: 5)
parentCheckTimer.setEventHandler {
  if getppid() == 1 {
    exit(0)
  }
}
parentCheckTimer.resume()

CFRunLoopRun()

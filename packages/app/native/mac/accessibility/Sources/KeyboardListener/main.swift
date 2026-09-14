import Cocoa
import CoreGraphics
import KeyboardListenerCore

// 全键盘原始物理输入监听器：输出每个按键（含 Fn/Globe 与左右侧修饰键）的 down/up/reset，
// 不判断 chord、press、doublePress、hold 或任何 action/scope 语义

var state = KeyboardPhysicalState()
let eventEncoder = KeyboardListenerEventEncoder()
let commandDecoder = KeyboardListenerCommandDecoder()
var eventTap: CFMachPort?
/// 由主进程经 stdin 的 config 命令开关；只在主线程读写，tap 回调与 stdin 读取都跑在主 run loop 上
var globeKeySuppressed = false

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

  // 裸 Fn 归上层动作时，在这里拦下系统的 🌐 键动作
  //
  // 实测症状：「按下🌐键时」设为「显示表情与符号」，单击 Fn 触发上层动作的同时表情面板也弹出来；
  // 设为「更改输入法」则每次都切一次输入法
  // 根因：Fn 单独按下再松开，系统在 flagsChanged up 之后紧接着合成一对 keyCode 0xB3 的
  // keyDown / keyUp（在 .cghidEventTap 实测可见，「不执行任何操作」下同样产生），
  // 前台 App 的 HIToolbox 收到它才按设置执行动作。tap 是 .defaultTap，对这一对 return nil
  // 就等价于把系统设置切成「不执行任何操作」
  // 边界：只吞 0xB3 的 keyDown / keyUp，Fn 自己的 flagsChanged 照常放行——fn+方向键 / fn+Delete /
  // fn+F1~F12 靠的是后续按键事件上的 maskSecondaryFn，与这一对合成事件无关（实测组合键未受影响）；
  // 早先担心的「吞掉 up 让 fn flag 状态失真」只针对吞 flagsChanged 的方案，这里不碰它
  // 是否要吞由主进程经 stdin 下发（见 KeyboardListenerCommand）：只有当前绑定里有裸 Fn 的动作才吞，
  // 绑定清空或改成组合键时交还系统默认行为
  if globeKeySuppressed, keyCode == globeKeyCode, type == .keyDown || type == .keyUp {
    return nil
  }

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

/// 主进程的下行命令：stdin 每行一个 JSON。挂在主队列上，与 tap 回调共用主线程，不需要加锁
/// EOF（父进程关掉了 stdin，或 stdin 是 /dev/null）就停止读取，退出仍由上面的父进程检查负责
var stdinBuffer = Data()
let stdinSource = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: DispatchQueue.main)
stdinSource.setEventHandler {
  var chunk = [UInt8](repeating: 0, count: 4096)
  let count = read(STDIN_FILENO, &chunk, chunk.count)
  if count <= 0 {
    stdinSource.cancel()
    return
  }
  stdinBuffer.append(contentsOf: chunk[0..<count])

  while let newline = stdinBuffer.firstIndex(of: UInt8(ascii: "\n")) {
    let line = stdinBuffer.subdata(in: stdinBuffer.startIndex..<newline)
    stdinBuffer.removeSubrange(stdinBuffer.startIndex...newline)
    guard let command = commandDecoder.decode(line) else {
      fputs("KEYBOARD_COMMAND_IGNORED\n", stderr)
      continue
    }
    switch command {
      case let .config(suppressGlobeKey):
        globeKeySuppressed = suppressGlobeKey
    }
  }
}
stdinSource.resume()

CFRunLoopRun()

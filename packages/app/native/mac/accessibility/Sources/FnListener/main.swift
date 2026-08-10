import Cocoa
import CoreGraphics
import FnListenerCore

// Fn/Globe 原始物理输入监听器，只输出标准化 down/up/reset，不判断快捷键手势
let functionKeyCode: Int64 = 0x3F
let fnComboWindowSeconds = 0.6

var reducer = FnPhysicalEventReducer()
var inputClassifier = FnPhysicalInputClassifier()
let eventEncoder = FnNativeEventEncoder()
var fnDownAt = 0.0
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

func output(_ events: [FnNativeEvent]) {
  for event in events {
    do {
      output(try eventEncoder.encode(event))
    }
    catch {
      fputs("FN_EVENT_ENCODE_FAILED\n", stderr)
      exit(1)
    }
  }
}

func isAccessibilityTrusted(prompt: Bool) -> Bool {
  let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
  return AXIsProcessTrustedWithOptions([key: prompt] as CFDictionary)
}

func modifiers(from event: CGEvent) -> [FnModifier] {
  var modifiers: [FnModifier] = []
  let flags = event.flags
  if flags.contains(.maskControl) { modifiers.append(.control) }
  if flags.contains(.maskAlternate) { modifiers.append(.alt) }
  if flags.contains(.maskShift) { modifiers.append(.shift) }
  if flags.contains(.maskCommand) { modifiers.append(.meta) }
  return modifiers
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
    output(reducer.reset(timestamp: timestamp))
    fnDownAt = 0
    if let tap = eventTap {
      CGEvent.tapEnable(tap: tap, enable: true)
    }
    return Unmanaged.passUnretained(event)
  }

  let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
  let hasFnFlag = event.flags.contains(.maskSecondaryFn)

  if type == .flagsChanged, keyCode == functionKeyCode {
    let phase = inputClassifier.classify(
      hasFnFlag: hasFnFlag,
      isFnDown: reducer.isFnDown
    )
    if phase == .down {
      fnDownAt = ProcessInfo.processInfo.systemUptime
      output(reducer.handleFnDown(timestamp: timestamp))
    }
    else if phase == .up {
      output(reducer.handleFnUp(timestamp: timestamp))
      fnDownAt = 0
    }
    return Unmanaged.passUnretained(event)
  }

  if type == .keyDown {
    let isAutorepeat = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
    let withinFallbackWindow = reducer.isFnDown
      && ProcessInfo.processInfo.systemUptime - fnDownAt < fnComboWindowSeconds
    let belongsToFnChord = reducer.isFnDown && (hasFnFlag || withinFallbackWindow)

    output(reducer.handleKeyDown(
      keyCode: keyCode,
      modifiers: modifiers(from: event),
      timestamp: timestamp,
      belongsToFnChord: belongsToFnChord,
      isAutorepeat: isAutorepeat
    ))
  }
  else if type == .keyUp {
    output(reducer.handleKeyUp(keyCode: keyCode, timestamp: timestamp))
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

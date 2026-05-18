import Foundation
import IOKit.hid

let GLOBE_PAGE: UInt32  = 0x00FF
let GLOBE_USAGE: UInt32 = 0x0003
let KEYBOARD_PAGE: UInt32 = 0x07

// HID keyboard usage (page 0x07) → key name
// Names match the `combos[].key` config in Node.js
let COMBO_KEYS: [UInt32: String] = {
  let m: [UInt32: String] = [
    // Letters
    0x04: "A", 0x05: "B", 0x06: "C", 0x07: "D", 0x08: "E",
    0x09: "F", 0x0A: "G", 0x0B: "H", 0x0C: "I", 0x0D: "J",
    0x0E: "K", 0x0F: "L", 0x10: "M", 0x11: "N", 0x12: "O",
    0x13: "P", 0x14: "Q", 0x15: "R", 0x16: "S", 0x17: "T",
    0x18: "U", 0x19: "V", 0x1A: "W", 0x1B: "X", 0x1C: "Y",
    0x1D: "Z",

    // Numbers
    0x1E: "1", 0x1F: "2", 0x20: "3", 0x21: "4", 0x22: "5",
    0x23: "6", 0x24: "7", 0x25: "8", 0x26: "9", 0x27: "0",

    // Special
    0x28: "Enter",  0x29: "Escape",    0x2A: "Backspace",
    0x2B: "Tab",    0x2C: "Space",     0x39: "CapsLock",

    // Punctuation
    0x2D: "Minus",        0x2E: "Equal",
    0x2F: "LeftBracket",  0x30: "RightBracket",
    0x31: "Backslash",    0x33: "Semicolon",
    0x34: "Quote",        0x35: "Grave",
    0x36: "Comma",        0x37: "Period",
    0x38: "Slash",

    // Navigation
    0x49: "Insert", 0x4A: "Home",   0x4B: "PageUp",
    0x4C: "Delete", 0x4D: "End",    0x4E: "PageDown",
    0x4F: "Right",  0x50: "Left",   0x51: "Down", 0x52: "Up",

    // Function keys
    0x3A: "F1",  0x3B: "F2",  0x3C: "F3",  0x3D: "F4",
    0x3E: "F5",  0x3F: "F6",  0x40: "F7",  0x41: "F8",
    0x42: "F9",  0x43: "F10", 0x44: "F11", 0x45: "F12",

    // Modifiers
    0xE0: "Ctrl",       0xE4: "CtrlRight",
    0xE1: "Shift",      0xE5: "ShiftRight",
    0xE2: "Alt",        0xE6: "AltRight",
    0xE3: "Meta",       0xE7: "MetaRight",
  ]
  return m
}()

// macOS sends synthetic FN_UP before combo key arrives;
// buffer the UP briefly so we can detect the combo at HID level.
let FN_UP_BUFFER_SEC = 0.05
var fnHeld = false
var pendingFnUp = false
var fnUpTimer: DispatchWorkItem?

func output(_ msg: String) {
  print(msg)
  fflush(stdout)
}

let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
IOHIDManagerSetDeviceMatching(manager, nil)

IOHIDManagerRegisterInputValueCallback(manager, { _, _, _, value in
  let elem  = IOHIDValueGetElement(value)
  let page  = IOHIDElementGetUsagePage(elem)
  let usage = IOHIDElementGetUsage(elem)
  let v     = IOHIDValueGetIntegerValue(value)

  // Globe/Fn key
  if page == GLOBE_PAGE, usage == GLOBE_USAGE {
    if v != 0 {
      fnHeld = true
      pendingFnUp = false
      fnUpTimer?.cancel()
      fnUpTimer = nil
      output("FN_DOWN")
    } else {
      fnHeld = false
      pendingFnUp = true
      let timer = DispatchWorkItem {
        guard pendingFnUp else { return }
        pendingFnUp = false
        output("FN_UP")
      }
      fnUpTimer = timer
      DispatchQueue.main.asyncAfter(deadline: .now() + FN_UP_BUFFER_SEC, execute: timer)
    }
    return
  }

  // Keyboard keydown — detect combo while Fn held or pending
  if page == KEYBOARD_PAGE, v != 0 {
    if let keyName = COMBO_KEYS[usage], fnHeld || pendingFnUp {
      pendingFnUp = false
      fnUpTimer?.cancel()
      fnUpTimer = nil
      output("FN_COMBO_\(keyName)")
    }
  }
}, nil)

IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetCurrent(), CFRunLoopMode.defaultMode.rawValue)
let result = IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone))

// kIOReturnExclusiveAccess (-536870203) is expected when apps like Karabiner seize the
// standard keyboard HID interface. Globe key uses apple_vendor_top_case (0x00FF) which
// is a separate interface — events still come through normally, so we ignore the error.
guard result == kIOReturnSuccess || result == kIOReturnExclusiveAccess else {
  fputs("OPEN_FAILED:\(result)\n", stderr)
  exit(1)
}

CFRunLoopRun()

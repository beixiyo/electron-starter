import Cocoa
import CoreGraphics

// Fn/Globe 键监听 —— CGEventTap 版（仅需「辅助功能」，不需要「输入监控」）
//
// 为什么是 CGEventTap 而不是 IOHIDManager：
//   - IOHIDManager 读键盘 = 需要「输入监控」(kTCCServiceListenEvent)
//   - CGEvent.tapCreate(options: .defaultTap) 主动 tap = 只需「辅助功能」面板下的
//     PostEvent 授权(kTCCServicePostEvent)，不需要输入监控（Apple DTS Quinn 确认）
//   - 这是 Typeless 等应用的做法：libKeyboardHelper 就是一个主动 session tap
//
// Fn 键判定：
//   - 在 Karabiner 等环境下 CGEventFlags.maskSecondaryFn 会被剥掉（恒为 0），不可靠
//   - 可靠信号是 flagsChanged 事件里的 keyCode == 63 (kVK_Function)
//   - flagsChanged 按下发一次、松开发一次，用一个布尔翻转(toggle) 即可得到 down/up
//
// 对外协议（与旧 IOHID 版完全一致，主进程零改动）：
//   FN_DOWN / FN_UP / FN_COMBO_<key>

let kVK_Function: Int64 = 0x3F  // 63

// CGEvent 虚拟键码(kVK_*) → 键名。注意：这是虚拟键码，不是 HID usage！
// 键名与 Node.js 侧 combos[].key 配置保持一致
let COMBO_KEYS: [Int64: String] = [
  // Letters
  0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X", 8: "C", 9: "V",
  11: "B", 12: "Q", 13: "W", 14: "E", 15: "R", 16: "Y", 17: "T",
  31: "O", 32: "U", 34: "I", 35: "P", 37: "L", 38: "J", 40: "K", 45: "N", 46: "M",

  // Numbers
  18: "1", 19: "2", 20: "3", 21: "4", 23: "5", 22: "6", 26: "7", 28: "8", 25: "9", 29: "0",

  // Special
  36: "Enter", 53: "Escape", 51: "Backspace", 48: "Tab", 49: "Space",

  // Punctuation
  27: "Minus", 24: "Equal", 33: "LeftBracket", 30: "RightBracket",
  42: "Backslash", 41: "Semicolon", 39: "Quote", 50: "Grave",
  43: "Comma", 47: "Period", 44: "Slash",

  // Navigation
  115: "Home", 119: "End", 116: "PageUp", 121: "PageDown", 117: "Delete",
  123: "Left", 124: "Right", 125: "Down", 126: "Up",

  // Function keys
  122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6",
  98: "F7", 100: "F8", 101: "F9", 109: "F10", 103: "F11", 111: "F12",
]

func output(_ msg: String) {
  print(msg)
  if fflush(stdout) != 0 {
    exit(0)  // 父进程退出、管道断裂
  }
}

func isAccessibilityTrusted(prompt: Bool) -> Bool {
  let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
  let options = [key: prompt] as CFDictionary
  return AXIsProcessTrustedWithOptions(options)
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

// 从事件 flags 中提取修饰符，排除 fn/secondaryFn 本身
func modifierSuffix(from event: CGEvent) -> String {
  var mods: [String] = []
  let f = event.flags
  if f.contains(.maskControl)   { mods.append("Control") }
  if f.contains(.maskAlternate) { mods.append("Alt") }
  if f.contains(.maskShift)     { mods.append("Shift") }
  if f.contains(.maskCommand)   { mods.append("Meta") }
  return mods.isEmpty ? "" : ":" + mods.joined(separator: ",")
}

// Fn 按下态。只由 keyCode==63 的 flagsChanged 更新；keyDown 上的 maskSecondaryFn 不能单独推导 Fn 按下
// 原因：方向键、Home/End、PageUp/PageDown 等 function/navigation key 自身也可能带类似标志
// 组合键识别：
//   - 已确认 Fn 按下 + 有标志的 keydown → 直接判组合（非 Karabiner，零误判）
//   - 无标志的 keydown：仅在「Fn 刚按下 FN_COMBO_WINDOW_SEC 内」才判组合（兼容 Karabiner），
//     超窗即清零并补 FN_UP，杜绝把正常打字误判成组合键、并自愈掉边沿后的卡死态
let FN_COMBO_WINDOW_SEC = 0.6
var fnDown = false
var fnDownAt = 0.0
func nowSec() -> Double { ProcessInfo.processInfo.systemUptime }

var gTap: CFMachPort?

let callback: CGEventTapCallBack = { _, type, event, _ in
  // tap 被系统禁用（超时/用户输入）→ 重新启用，保证长期存活
  if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
    if let t = gTap {
      CGEvent.tapEnable(tap: t, enable: true)
    }
    return Unmanaged.passUnretained(event)
  }

  let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
  let hasFnFlag = event.flags.contains(.maskSecondaryFn)

  // Fn/Globe 键状态变化：keyCode==63 的 flagsChanged
  // 有 maskSecondaryFn 标志 → 按下（权威）；标志缺失 → 退回翻转
  if type == .flagsChanged, keyCode == kVK_Function {
    let newDown = hasFnFlag ? true : !fnDown
    if newDown != fnDown {
      fnDown = newDown
      if fnDown { fnDownAt = nowSec() }
      output(fnDown ? "FN_DOWN" : "FN_UP")
    }
    return Unmanaged.passUnretained(event)
  }

  // 普通按键 keydown
  if type == .keyDown {
    if hasFnFlag {
      // 带 Fn 标志不等于物理 Fn 已按下：方向键等 navigation key 自身也可能带该标志
      // 因此必须先收到 keyCode==63 的 flagsChanged，才能把 keydown 视为 Fn+ 组合键
      guard fnDown else {
        return Unmanaged.passUnretained(event)
      }

      if let keyName = COMBO_KEYS[keyCode] {
        output("FN_COMBO_\(keyName)\(modifierSuffix(from: event))")
      }
    }
    else if fnDown {
      if nowSec() - fnDownAt < FN_COMBO_WINDOW_SEC, let keyName = COMBO_KEYS[keyCode] {
        // Karabiner 下 flag 被剥：靠「Fn 刚按下不久」时间窗识别组合
        output("FN_COMBO_\(keyName)\(modifierSuffix(from: event))")
      }
      else {
        // 超窗 / 卡死态：清零并补 FN_UP，杜绝打字污染、自愈掉边沿
        fnDown = false
        output("FN_UP")
      }
    }
  }

  return Unmanaged.passUnretained(event)  // 始终透传，不拦截任何按键
}

// 需要「辅助功能」权限。正常启动只检查、不弹系统授权框；
// 未授权时直接退出，避免创建 event tap 时触发 macOS 原生辅助功能弹窗。
// 显式申请由 --prompt-accessibility 负责。
if !isAccessibilityTrusted(prompt: false) {
  fputs("ACCESSIBILITY_NOT_TRUSTED\n", stderr)
  exit(1)
}

let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)

guard let tap = CGEvent.tapCreate(
  tap: .cghidEventTap,           // HID 层：此处 maskSecondaryFn 标志完好（session 层会被剥成 0，
                                 // 仍能用但要退回翻转判定）。两层在真实 app 里都能用，选 HID 取其标志可靠
  place: .headInsertEventTap,
  options: .defaultTap,          // 主动 tap → 走「辅助功能(PostEvent)」，非「输入监控」
  eventsOfInterest: CGEventMask(mask),
  callback: callback,
  userInfo: nil
) else {
  fputs("TAP_CREATE_FAILED\n", stderr)  // 多半是没有辅助功能权限
  exit(1)
}

gTap = tap
let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

// 忽略 SIGPIPE（父进程退出时管道断裂，不要直接崩溃）
signal(SIGPIPE, SIG_IGN)

// 每 5 秒检测父进程是否存活
let parentCheckTimer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
parentCheckTimer.schedule(deadline: .now() + 5, repeating: 5)
parentCheckTimer.setEventHandler {
  if getppid() == 1 {
    exit(0)
  }
}
parentCheckTimer.resume()

CFRunLoopRun()

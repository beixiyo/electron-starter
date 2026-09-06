import Cocoa
import ApplicationServices
import CoreGraphics

/// 把 stdin 读到的 UTF-8 文本直接插到前台 App 焦点文本元素的光标处，**不经过系统剪贴板**
///
/// 两条路径按顺序尝试：
/// 1. `ax`：对焦点元素写 AXSelectedText。原生 Cocoa 文本控件的标准能力，一次原子编辑、可整段撤销
/// 2. `keyboard`：构造附带 Unicode 字符串的 keyDown 事件投给前台进程，对方收到的就是「有人敲了这些字」，
///    几乎任何能打字的地方都吃这一套，是 AX 不可写（Chromium / Electron / 终端等）时的兜底
///
/// stdout 输出 JSON：{"ok":true,"method":"ax","app":"Notes"} 或 {"ok":false,"reason":"…","app":"…"}
/// `--method=ax|keyboard` 只走指定路径，用于排查各 App 的兼容矩阵；默认两条都试
/// 需要辅助功能权限（与 focus-check / fn-listener 共享同一权限）

enum InsertMethod: String {
  case ax
  case keyboard
}

struct InsertOutcome {
  let ok: Bool
  let method: InsertMethod?
  let reason: String?
  let app: String?
}

/// 单个键盘事件最多携带的 UTF-16 单元数，CGEventKeyboardSetUnicodeString 的上限
private let unicodeUnitsPerKeyEvent = 20
/// 相邻键盘事件之间的间隔，给目标 App 留出处理时间
private let keyEventGapMicroseconds: useconds_t = 5_000
/// 最后一个键盘事件发出后、进程退出前的等待
///
/// 实测：CGEvent 投递是异步的，发完立刻退出会截断尚未送出的事件——68 字的长句只落地前 40 个
/// UTF-16 单元（正好两块），多行文本换行后全丢；投给进程还是投给 HID 层结果一样。
/// 退出前留 300ms 或把事件间隔拉到 20ms 都能全部送达，说明只差一个「等队列排空」的机会。
/// 系统没有公开的 flush 接口，只能用固定等待兜住
private let keyEventFlushMicroseconds: useconds_t = 200_000
/// AX 写入后等待目标 App 把新值同步回 AX 树的时间，用于确认写入确实生效
private let axSettleMicroseconds: useconds_t = 50_000
private let returnKeyCode: CGKeyCode = 36
private let shiftKeyCode: CGKeyCode = 56

func main() {
  let forced = parseForcedMethod(CommandLine.arguments)
  let data = FileHandle.standardInput.readDataToEndOfFile()

  guard let text = String(data: data, encoding: .utf8), !text.isEmpty else {
    emit(InsertOutcome(ok: false, method: nil, reason: "empty-text", app: nil))
    return
  }
  guard let frontApp = NSWorkspace.shared.frontmostApplication else {
    emit(InsertOutcome(ok: false, method: nil, reason: "no-frontmost-app", app: nil))
    return
  }

  let appName = frontApp.localizedName
  let pid = frontApp.processIdentifier
  let focused = focusedElement(ofPid: pid)
  let role = focused.flatMap { stringAttribute($0, kAXRoleAttribute) }
  let payload = normalizeLineBreaks(text, role: role)

  if forced != .keyboard {
    if let focused, insertViaAccessibility(payload, into: focused) {
      emit(InsertOutcome(ok: true, method: .ax, reason: nil, app: appName))
      return
    }
    if forced == .ax {
      emit(InsertOutcome(ok: false, method: nil, reason: "ax-not-settable", app: appName))
      return
    }
  }

  if insertViaKeyboard(payload, pid: pid) {
    usleep(keyEventFlushMicroseconds)
    emit(InsertOutcome(ok: true, method: .keyboard, reason: nil, app: appName))
  } else {
    emit(InsertOutcome(ok: false, method: nil, reason: "keyboard-post-failed", app: appName))
  }
}

/// 统一换行符，并按焦点元素角色决定换行去向
///
/// 单行控件（AXTextField / AXComboBox：搜索框、地址栏、表单 input）装不下换行，而 Return 在这类控件上多半是提交；
/// 换行折成空格，既不丢词也不触发提交。多行控件原样保留，键盘路径再按 Shift+Return 发出
func normalizeLineBreaks(_ text: String, role: String?) -> String {
  let unified = text
    .replacingOccurrences(of: "\r\n", with: "\n")
    .replacingOccurrences(of: "\r", with: "\n")

  let singleLineRoles: Set<String> = [kAXTextFieldRole as String, kAXComboBoxRole as String]
  guard let role, singleLineRoles.contains(role) else { return unified }
  return unified.replacingOccurrences(of: "\n", with: " ")
}

func parseForcedMethod(_ arguments: [String]) -> InsertMethod? {
  for argument in arguments where argument.hasPrefix("--method=") {
    return InsertMethod(rawValue: String(argument.dropFirst("--method=".count)))
  }
  return nil
}

/// 前台进程的焦点元素；与 FocusCheck 同款，先给 Electron / Chromium 打开完整 AX 树
func focusedElement(ofPid pid: pid_t) -> AXUIElement? {
  let appElement = AXUIElementCreateApplication(pid)
  AXUIElementSetAttributeValue(appElement, "AXManualAccessibility" as CFString, kCFBooleanTrue)
  AXUIElementSetAttributeValue(appElement, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)

  var focusedRef: AnyObject?
  guard AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &focusedRef) == .success,
        let focused = focusedRef else {
    return nil
  }
  return (focused as! AXUIElement)
}

/// AX 路径：写 AXSelectedText 等价于「替换当前选区」，无选区时就是在光标处插入
func insertViaAccessibility(_ text: String, into element: AXUIElement) -> Bool {
  var settable: DarwinBoolean = false
  guard AXUIElementIsAttributeSettable(element, kAXSelectedTextAttribute as CFString, &settable) == .success,
        settable.boolValue else {
    return false
  }

  let before = stringAttribute(element, kAXValueAttribute)
  guard AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFTypeRef) == .success else {
    return false
  }

  /// 部分 App 对不支持的写入也回 success 却什么都没发生。能读到 AXValue 时要求内容确实变了，
  /// 否则退到键盘路径；只比较「变没变」而不比较精确内容，自动缩进、智能引号会改写插入结果
  if let before {
    usleep(axSettleMicroseconds)
    if let after = stringAttribute(element, kAXValueAttribute), after == before {
      return false
    }
  }
  return true
}

func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
  var valueRef: AnyObject?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &valueRef) == .success else { return nil }
  return valueRef as? String
}

/// 键盘路径：按行拆分，行内按 20 个 UTF-16 单元分块投递，换行单独发 Shift+Return
///
/// 事件直接投给目标进程而不是系统 HID 层，避免被别的事件监听器截走；
/// 显式清空修饰键，防止用户仍按着的 Fn / Shift 混进去
func insertViaKeyboard(_ text: String, pid: pid_t) -> Bool {
  guard let source = CGEventSource(stateID: .combinedSessionState) else { return false }

  let lines = text.split(separator: "\n", omittingEmptySubsequences: false)

  for (index, line) in lines.enumerated() {
    guard typeLine(String(line), source: source, pid: pid) else { return false }
    if index < lines.count - 1 {
      guard pressShiftReturn(source: source, pid: pid) else { return false }
    }
  }
  return true
}

func typeLine(_ line: String, source: CGEventSource, pid: pid_t) -> Bool {
  let units = Array(line.utf16)
  var start = 0

  while start < units.count {
    var end = min(start + unicodeUnitsPerKeyEvent, units.count)
    /// 不能把代理对拆到两个事件里，否则 emoji 这类字符会变成乱码
    if end < units.count, UTF16.isLeadSurrogate(units[end - 1]) {
      end -= 1
    }

    var chunk = Array(units[start..<end])
    guard let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
          let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else {
      return false
    }
    keyDown.flags = []
    keyUp.flags = []
    keyDown.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: &chunk)
    keyUp.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: &chunk)
    keyDown.postToPid(pid)
    keyUp.postToPid(pid)
    usleep(keyEventGapMicroseconds)

    start = end
  }
  return true
}

/// 换行发 Shift+Return 而不是裸 Return
///
/// 实测症状：转写含换行时注入飞书这类聊天框，换行直接把前半句发了出去，
/// 而需求要求「换行原样保留、注入不得触发发送」。
/// 根因：聊天类 App 把裸 Return 绑成发送，只有 Shift+Return 是换行；文本编辑器、浏览器 textarea
/// 对 Shift+Return 同样按换行处理，统一走它没有代价。除了在 Return 事件上打 Shift 标志，
/// 还真实按下 / 抬起 Shift 键，兼顾读事件标志与读修饰键状态两种实现
func pressShiftReturn(source: CGEventSource, pid: pid_t) -> Bool {
  guard let shiftDown = CGEvent(keyboardEventSource: source, virtualKey: shiftKeyCode, keyDown: true),
        let returnDown = CGEvent(keyboardEventSource: source, virtualKey: returnKeyCode, keyDown: true),
        let returnUp = CGEvent(keyboardEventSource: source, virtualKey: returnKeyCode, keyDown: false),
        let shiftUp = CGEvent(keyboardEventSource: source, virtualKey: shiftKeyCode, keyDown: false) else {
    return false
  }
  shiftDown.flags = .maskShift
  returnDown.flags = .maskShift
  returnUp.flags = .maskShift
  shiftUp.flags = []

  for event in [shiftDown, returnDown, returnUp, shiftUp] {
    event.postToPid(pid)
  }
  usleep(keyEventGapMicroseconds)
  return true
}

func emit(_ outcome: InsertOutcome) {
  let methodStr = outcome.method.map { "\"\($0.rawValue)\"" } ?? "null"
  let reasonStr = outcome.reason.map { "\"\(escapeJSON($0))\"" } ?? "null"
  let appStr = outcome.app.map { "\"\(escapeJSON($0))\"" } ?? "null"
  print("{\"ok\":\(outcome.ok),\"method\":\(methodStr),\"reason\":\(reasonStr),\"app\":\(appStr)}")
  fflush(stdout)
}

func escapeJSON(_ s: String) -> String {
  return s
    .replacingOccurrences(of: "\\", with: "\\\\")
    .replacingOccurrences(of: "\"", with: "\\\"")
}

main()

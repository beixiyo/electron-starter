import Cocoa
import ApplicationServices
import CoreGraphics

/// 把 stdin 读到的 UTF-8 文本插到前台 App 焦点文本元素的光标处，用户剪贴板前后内容不变
///
/// 两条路径按顺序尝试：
/// 1. `ax`：对焦点元素写 AXSelectedText。原生 Cocoa 文本控件的标准能力，一次原子编辑、可整段撤销，完全不碰剪贴板
/// 2. `paste`：快照剪贴板 → 写入文本 → 发 Cmd+V → 等目标读完再写回快照。AX 不可写（Chromium / Electron / 终端等）时的兜底
///
/// 曾经的兜底是逐块发键盘事件，已废弃：换行怎么解释由目标 App 决定，裸 Return 在聊天框是发送，
/// Shift+Return 在 VS Code 终端（xterm.js）被编码成裸回车、只有 kitty 这类支持新键盘协议的终端才当换行；
/// 粘贴走 bracketed paste，换行以字面形式送达，任何目标都一致。Typeless / type4me 等同类工具也都以粘贴为兜底
///
/// stdout 输出 JSON：{"ok":true,"method":"ax","app":"Notes"} 或 {"ok":false,"reason":"…","app":"…"}
/// `--method=ax|paste` 只走指定路径，用于排查各 App 的兼容矩阵；默认两条都试
/// 需要辅助功能权限（与 focus-check / fn-listener 共享同一权限）

enum InsertMethod: String {
  case ax
  case paste
}

struct InsertOutcome {
  let ok: Bool
  let method: InsertMethod?
  let reason: String?
  let app: String?
}

/// AX 写入后等待目标 App 把新值同步回 AX 树的时间，用于确认写入确实生效
private let axSettleMicroseconds: useconds_t = 50_000
/// 写完剪贴板到发 Cmd+V 之间的间隔，让 pasteboard 服务先落盘
private let pasteboardSettleMicroseconds: useconds_t = 50_000
/// Cmd+V 发出后到写回原剪贴板的等待
///
/// 目标 App 读剪贴板是异步的，写回太早会把旧内容粘进去。type4me 实测 Electron 系（VS Code / Slack / Notion / 飞书）
/// 要 200~500ms，150ms 太快，最终取 400ms 左右；这里沿用该经验值
private let pasteRestoreDelayMicroseconds: useconds_t = 400_000
private let vKeyCode: CGKeyCode = 9

/// 剪贴板历史工具（Paste / Maccy 等）约定：带此类型的写入不计入历史
private let transientPasteboardType = NSPasteboard.PasteboardType("org.nspasteboard.TransientType")
/// 通用剪贴板约定：带此类型的写入不同步到用户的其他设备
private let concealedPasteboardType = NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")

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
  let focused = focusedElement(ofPid: frontApp.processIdentifier)
  let role = focused.flatMap { stringAttribute($0, kAXRoleAttribute) }
  let unified = unifyLineBreaks(text)

  if forced != .paste {
    if let focused, insertViaAccessibility(foldLineBreaksForSingleLine(unified, role: role), into: focused) {
      emit(InsertOutcome(ok: true, method: .ax, reason: nil, app: appName))
      return
    }
    if forced == .ax {
      emit(InsertOutcome(ok: false, method: nil, reason: "ax-not-settable", app: appName))
      return
    }
  }

  if insertViaPaste(unified) {
    emit(InsertOutcome(ok: true, method: .paste, reason: nil, app: appName))
  } else {
    emit(InsertOutcome(ok: false, method: nil, reason: "paste-event-failed", app: appName))
  }
}

func unifyLineBreaks(_ text: String) -> String {
  return text
    .replacingOccurrences(of: "\r\n", with: "\n")
    .replacingOccurrences(of: "\r", with: "\n")
}

/// AX 路径专用：单行控件（AXTextField / AXComboBox：搜索框、地址栏、表单 input）装不下换行，
/// 直写字面换行会得到一个显示怪异的值，折成空格不丢词
///
/// 粘贴路径**不做**这个折叠：粘贴不按 Return，不存在触发提交的风险，换行怎么处理交给目标自己；
/// 而且角色判定在终端上会误判——xterm.js（VS Code 终端）给隐藏 textarea 标了 aria-multiline=false，
/// Chromium 因此把它暴露成 AXTextField，按单行折叠会把 Claude Code 里的多行输入压成一行（实测）
func foldLineBreaksForSingleLine(_ text: String, role: String?) -> String {
  let singleLineRoles: Set<String> = [kAXTextFieldRole as String, kAXComboBoxRole as String]
  guard let role, singleLineRoles.contains(role) else { return text }
  return text.replacingOccurrences(of: "\n", with: " ")
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

// MARK: - AX 路径

/// 写 AXSelectedText 等价于「替换当前选区」，无选区时就是在光标处插入
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
  /// 否则退到粘贴路径；只比较「变没变」而不比较精确内容，自动缩进、智能引号会改写插入结果
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

// MARK: - 粘贴路径

/// 快照 → 写入 → Cmd+V → 写回。对用户而言剪贴板前后内容不变
///
/// 写回前比对 changeCount：用户在这几百毫秒里自己复制了新内容，就放弃写回、不覆盖
func insertViaPaste(_ text: String) -> Bool {
  let pasteboard = NSPasteboard.general
  let snapshot = ClipboardSnapshot.capture(from: pasteboard)

  pasteboard.clearContents()
  let item = NSPasteboardItem()
  item.setString(text, forType: .string)
  markInternal(item)
  pasteboard.writeObjects([item])
  let changeCountAfterWrite = pasteboard.changeCount
  usleep(pasteboardSettleMicroseconds)

  guard postCommandV() else {
    /// 事件都发不出去，剪贴板里留着的是我们的文本；立即还原，不让转写文本泄漏进用户剪贴板
    snapshot.restore(to: pasteboard, expectedChangeCount: changeCountAfterWrite)
    return false
  }

  usleep(pasteRestoreDelayMicroseconds)
  snapshot.restore(to: pasteboard, expectedChangeCount: changeCountAfterWrite)
  return true
}

/// Cmd+V 投到 HID 层而不是指定进程：终端类 App 有的只认系统层事件
/// 同时真实按下 / 抬起 Command 键，兼顾读事件标志与读修饰键状态两种实现
func postCommandV() -> Bool {
  let commandKeyCode: CGKeyCode = 55
  guard let source = CGEventSource(stateID: .combinedSessionState),
        let commandDown = CGEvent(keyboardEventSource: source, virtualKey: commandKeyCode, keyDown: true),
        let vDown = CGEvent(keyboardEventSource: source, virtualKey: vKeyCode, keyDown: true),
        let vUp = CGEvent(keyboardEventSource: source, virtualKey: vKeyCode, keyDown: false),
        let commandUp = CGEvent(keyboardEventSource: source, virtualKey: commandKeyCode, keyDown: false) else {
    return false
  }
  commandDown.flags = .maskCommand
  vDown.flags = .maskCommand
  vUp.flags = .maskCommand
  commandUp.flags = []

  for event in [commandDown, vDown, vUp, commandUp] {
    event.post(tap: .cghidEventTap)
  }
  return true
}

/// 标记为内部流量：不进剪贴板历史，不同步到其他设备
func markInternal(_ item: NSPasteboardItem) {
  item.setData(Data(), forType: transientPasteboardType)
  item.setData(Data(), forType: concealedPasteboardType)
}

/// 用户剪贴板的文本类快照
///
/// 只抓文本类类型。图片、RTF、文件承诺这些二进制类型的读取会触发其他 App 的惰性数据提供者，
/// 可能把调用线程无限期卡住（type4me 的实测结论）；宁可少恢复一种格式，不能让注入卡死
struct ClipboardSnapshot {
  private static let safeTypes: Set<String> = [
    NSPasteboard.PasteboardType.string.rawValue,
    NSPasteboard.PasteboardType.URL.rawValue,
    NSPasteboard.PasteboardType.html.rawValue,
    "public.utf8-plain-text",
    "public.utf16-plain-text",
    "public.url",
  ]

  struct Item {
    let data: [NSPasteboard.PasteboardType: Data]
  }

  let items: [Item]

  static func capture(from pasteboard: NSPasteboard) -> ClipboardSnapshot {
    var items: [Item] = []
    for pasteboardItem in pasteboard.pasteboardItems ?? [] {
      var dataMap: [NSPasteboard.PasteboardType: Data] = [:]
      for type in pasteboardItem.types where safeTypes.contains(type.rawValue) {
        if let data = pasteboardItem.data(forType: type) {
          dataMap[type] = data
        }
      }
      if !dataMap.isEmpty {
        items.append(Item(data: dataMap))
      }
    }
    return ClipboardSnapshot(items: items)
  }

  /// 只在剪贴板仍是我们写入的那一版时写回；原剪贴板为空则清空
  func restore(to pasteboard: NSPasteboard, expectedChangeCount: Int) {
    guard pasteboard.changeCount == expectedChangeCount else { return }
    pasteboard.clearContents()

    let restored = items.map { item -> NSPasteboardItem in
      let pasteboardItem = NSPasteboardItem()
      for (type, data) in item.data {
        pasteboardItem.setData(data, forType: type)
      }
      markInternal(pasteboardItem)
      return pasteboardItem
    }
    guard !restored.isEmpty else { return }
    pasteboard.writeObjects(restored)
  }
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

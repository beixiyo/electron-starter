import Cocoa
import ApplicationServices
import CoreGraphics

/// 把 stdin 读到的 UTF-8 文本插到前台 App 焦点文本元素的光标处，用户剪贴板前后内容不变
///
/// 两条路径按顺序尝试：
/// 1. `ax`：对焦点元素写 AXSelectedText。原生 Cocoa 文本控件的标准能力，一次原子编辑、可整段撤销，完全不碰剪贴板
/// 2. `paste`：快照剪贴板 → 把文本作为**惰性承诺**放上剪贴板 → 发 Cmd+V → 等目标真正读取 → 写回快照
///    AX 不可写（Chromium / Electron / 终端等）时的兜底
///
/// **粘贴路径带「读回执」，但回执只是必要条件，不是送达证明。** 文本用 `declareTypes:owner:` 作为惰性承诺放上剪贴板，
/// 目标 App 处理 Cmd+V 真正调 `stringForType:` 时 pasteboard 服务回到本进程调 `pasteboard:provideDataForType:`
/// 回执的三个用途：
/// 1. 还原剪贴板的时机——回执后静默 200 ms 即可写回，比固定等 400 ms 更快也更稳（慢目标可等到 1.5 s）
/// 2. 预算内**没有任何进程读**剪贴板 → 报 `paste-not-consumed`：没人读一定没粘，调用方视为没有落点而不是判成功
/// 3. `receiptMs` / `receiptCount` 供调用方落诊断日志，排查时能看出目标什么时候读、读了几次
///
/// 曾试过把回执当投递闸门、把 focus-check 的 AX 角色判定拆掉，实测证明不可行：Chrome 焦点在 body
/// （页面无 paste 监听）32 ms 就读了、Safari 空白页 0 ms、系统设置侧栏（`AXOutline`）138 ms，文本全都没落——
/// 菜单项校验、SwiftUI 粘贴命令、Chromium 构建 paste 事件都会读剪贴板，实测连续三次文本无声消失
/// 「有人读」证明不了任何事，能不能投仍由 `focus-check` 的 AX 判定决定
///
/// 已实测的边界：只查 `types` / `canReadObject` 不触发回执；纯 CLI 进程泵 RunLoop 即可收到回执，不需要
/// NSApplication；兑现承诺不改变 `changeCount`，写回快照的守卫仍可靠。假回执来源还有剪贴板历史工具主动读取：
/// 带 Transient / Concealed 标记（守约的工具会跳过），只认 Cmd+V 发出之后的回执
///
/// 曾经的兜底是逐块发键盘事件，已废弃：换行怎么解释由目标 App 决定，裸 Return 在聊天框是发送，
/// Shift+Return 在 VS Code 终端（xterm.js）被编码成裸回车、只有 kitty 这类支持新键盘协议的终端才当换行；
/// 粘贴走 bracketed paste，换行以字面形式送达，任何目标都一致
///
/// stdout 输出 JSON：{"ok":true,"method":"paste","reason":null,"app":"Code","receiptMs":41,"receiptCount":2}
/// 或 {"ok":false,"method":null,"reason":"paste-not-consumed","app":"Finder","receiptMs":null,"receiptCount":0}
/// `--method=ax|paste` 只走指定路径，用于排查各 App 的兼容矩阵；默认两条都试
/// 需要辅助功能权限（与 focus-check / keyboard-listener 共享同一权限）

enum InsertMethod: String {
  case ax
  case paste
}

/// 失败原因；`paste-not-consumed` 是唯一「程序一切正常、只是预算内没人读剪贴板」的结果，调用方据它视为没有落点而不是再盲粘一次
enum InsertFailure: String {
  case emptyText = "empty-text"
  case noFrontmostApp = "no-frontmost-app"
  case axNotSettable = "ax-not-settable"
  case pasteEventFailed = "paste-event-failed"
  case pasteNotConsumed = "paste-not-consumed"
}

struct InsertOutcome {
  let ok: Bool
  let method: InsertMethod?
  let reason: InsertFailure?
  let app: String?
  /// 粘贴路径：从发出 Cmd+V 到目标第一次读取剪贴板文本的毫秒数；没有回执或没走粘贴时为 nil
  let receiptMs: Int?
  /// 粘贴路径：Cmd+V 之后收到的回执总数
  let receiptCount: Int
}

/// AX 写入后等待目标 App 把新值同步回 AX 树的时间，用于确认写入确实生效
private let axSettleSeconds: TimeInterval = 0.05
/// 写完剪贴板到发 Cmd+V 之间的间隔，让 pasteboard 服务先落盘；期间泵 RunLoop，
/// 让剪贴板工具因写入而触发的早期读取在 Cmd+V 之前就被消费掉，不混进回执
private let pasteboardSettleSeconds: TimeInterval = 0.05
/// Cmd+V 发出后等待**第一次**回执的预算；超过即判没人读、没送达
///
/// 目标读剪贴板是异步的：AppKit 控件几毫秒，Electron 系（VS Code / Slack / Notion）type4me 实测 200~500 ms，
/// 主线程忙（终端刷屏）时更久。预算既是无人读时判成没有落点的延迟，也是「先超时还原、目标后来才粘」这一竞态的护栏
/// ——那种情况粘进去的是还原后的用户旧剪贴板；预算越长越安全，取 1.5 s
private let receiptWaitBudgetSeconds: TimeInterval = 1.5
/// 最后一次回执之后的静默期，静默满了才写回快照。Chromium 会先探后读，Handy 实测 200 ms 够用
private let receiptQuietSeconds: TimeInterval = 0.2
/// 有回执但一直不静默（剪贴板工具反复读）时的总上限，避免进程挂住
private let receiptSettleCapSeconds: TimeInterval = 3.0
/// 泵 RunLoop 的步长
private let runLoopStepSeconds: TimeInterval = 0.015
private let vKeyCode: CGKeyCode = 9

/// 剪贴板历史工具（Paste / Maccy 等）约定：带此类型的写入不计入历史
private let transientPasteboardType = NSPasteboard.PasteboardType("org.nspasteboard.TransientType")
/// 通用剪贴板约定：带此类型的写入不同步到用户的其他设备
private let concealedPasteboardType = NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")

func main() {
  let forced = parseForcedMethod(CommandLine.arguments)
  let data = FileHandle.standardInput.readDataToEndOfFile()

  guard let text = String(data: data, encoding: .utf8), !text.isEmpty else {
    emit(InsertOutcome(ok: false, method: nil, reason: .emptyText, app: nil, receiptMs: nil, receiptCount: 0))
    return
  }
  guard let frontApp = NSWorkspace.shared.frontmostApplication else {
    emit(InsertOutcome(ok: false, method: nil, reason: .noFrontmostApp, app: nil, receiptMs: nil, receiptCount: 0))
    return
  }

  let appName = frontApp.localizedName
  let focused = focusedElement(ofPid: frontApp.processIdentifier)
  let role = focused.flatMap { stringAttribute($0, kAXRoleAttribute) }
  let unified = unifyLineBreaks(text)

  if forced != .paste {
    if let focused, insertViaAccessibility(foldLineBreaksForSingleLine(unified, role: role), into: focused) {
      emit(InsertOutcome(ok: true, method: .ax, reason: nil, app: appName, receiptMs: nil, receiptCount: 0))
      return
    }
    if forced == .ax {
      emit(InsertOutcome(ok: false, method: nil, reason: .axNotSettable, app: appName, receiptMs: nil, receiptCount: 0))
      return
    }
  }

  let paste = insertViaPaste(unified)
  switch paste.result {
  case .consumed:
    emit(InsertOutcome(ok: true, method: .paste, reason: nil, app: appName, receiptMs: paste.firstReceiptMs, receiptCount: paste.receiptCount))
  case .notConsumed:
    emit(InsertOutcome(ok: false, method: nil, reason: .pasteNotConsumed, app: appName, receiptMs: nil, receiptCount: paste.receiptCount))
  case .eventFailed:
    emit(InsertOutcome(ok: false, method: nil, reason: .pasteEventFailed, app: appName, receiptMs: nil, receiptCount: 0))
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
/// Chromium 因此把它暴露成 AXTextField，按单行折叠会把多行输入压成一行（实测）
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
///
/// 只对 AXValue 是字符串的元素动手：Chromium 把滑块、复选框、下拉框的 AXSelectedText 也报成可写，
/// 它们的 AXValue 是数字 / 布尔。曾经 AXValue 读不到字符串就跳过校验直接判成功，
/// 实测 `AXSlider` 场景的文本就是这样无声消失的；现在这类元素直接退到粘贴路径
func insertViaAccessibility(_ text: String, into element: AXUIElement) -> Bool {
  var settable: DarwinBoolean = false
  guard AXUIElementIsAttributeSettable(element, kAXSelectedTextAttribute as CFString, &settable) == .success,
        settable.boolValue,
        let before = stringAttribute(element, kAXValueAttribute) else {
    return false
  }

  guard AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFTypeRef) == .success else {
    return false
  }

  /// 部分 App 对不支持的写入也回 success 却什么都没发生。要求内容确实变了，否则退到粘贴路径；
  /// 只比较「变没变」而不比较精确内容，自动缩进、智能引号会改写插入结果
  Thread.sleep(forTimeInterval: axSettleSeconds)
  if let after = stringAttribute(element, kAXValueAttribute), after == before {
    return false
  }
  return true
}

func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
  var valueRef: AnyObject?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &valueRef) == .success else { return nil }
  return valueRef as? String
}

// MARK: - 粘贴路径

enum PasteResult {
  /// Cmd+V 之后目标读了剪贴板文本
  case consumed
  /// 预算内没有任何读取，文本没送达；剪贴板已还原
  case notConsumed
  /// Cmd+V 事件都发不出去
  case eventFailed
}

struct PasteOutcome {
  let result: PasteResult
  let firstReceiptMs: Int?
  let receiptCount: Int
}

/// 快照 → 承诺 → Cmd+V → 等回执 → 写回。对用户而言剪贴板前后内容不变
///
/// 写回前比对 changeCount：用户在这期间自己复制了新内容，就放弃写回、不覆盖
/// 承诺被别的写入者顶掉（`pasteboardChangedOwner:`）时同样不写回；此时若还没有回执，
/// 目标即便处理了 Cmd+V 粘的也是别人的内容，照实报 `notConsumed`
func insertViaPaste(_ text: String) -> PasteOutcome {
  let pasteboard = NSPasteboard.general
  let snapshot = ClipboardSnapshot.capture(from: pasteboard)
  let provider = PromisedTextProvider(text: text)

  /// 文本只登记类型、由 provider 惰性提供；两个标记类型当场给空数据，
  /// 剪贴板工具查标记时不会走到 provider，回执只可能来自对文本本身的读取
  let changeCountAfterWrite = pasteboard.declareTypes([.string, transientPasteboardType, concealedPasteboardType], owner: provider)
  pasteboard.setData(Data(), forType: transientPasteboardType)
  pasteboard.setData(Data(), forType: concealedPasteboardType)
  pumpRunLoop(for: pasteboardSettleSeconds)

  guard postCommandV() else {
    /// 事件都发不出去，剪贴板里挂着的是我们的承诺；立即还原，不让待插入文本泄漏进用户剪贴板
    snapshot.restore(to: pasteboard, expectedChangeCount: changeCountAfterWrite)
    return PasteOutcome(result: .eventFailed, firstReceiptMs: nil, receiptCount: 0)
  }

  let injectedAt = Date()
  let wait = waitForReceipts(provider: provider, since: injectedAt)
  snapshot.restore(to: pasteboard, expectedChangeCount: changeCountAfterWrite)

  guard let firstReceipt = wait.firstReceipt else {
    return PasteOutcome(result: .notConsumed, firstReceiptMs: nil, receiptCount: 0)
  }
  return PasteOutcome(
    result: .consumed,
    firstReceiptMs: Int(firstReceipt.timeIntervalSince(injectedAt) * 1000),
    receiptCount: wait.receiptCount,
  )
}

/// 泵 RunLoop 直到：有回执且静默期已满 / 预算内无回执 / 总上限到期 / 承诺被顶掉
///
/// 只认 `since` 之后的回执：写入剪贴板那一刻剪贴板工具就可能读一次，那不是目标 App
func waitForReceipts(provider: PromisedTextProvider, since injectedAt: Date) -> (firstReceipt: Date?, receiptCount: Int) {
  while true {
    RunLoop.main.run(mode: .default, before: Date(timeIntervalSinceNow: runLoopStepSeconds))
    let now = Date()
    let receipts = provider.receipts.filter { $0 >= injectedAt }
    let elapsed = now.timeIntervalSince(injectedAt)

    if provider.ownershipLost {
      return (receipts.first, receipts.count)
    }
    if let last = receipts.last {
      if now.timeIntervalSince(last) >= receiptQuietSeconds || elapsed >= receiptSettleCapSeconds {
        return (receipts.first, receipts.count)
      }
      continue
    }
    if elapsed >= receiptWaitBudgetSeconds {
      return (nil, 0)
    }
  }
}

func pumpRunLoop(for seconds: TimeInterval) {
  let deadline = Date(timeIntervalSinceNow: seconds)
  while Date() < deadline {
    RunLoop.main.run(mode: .default, before: deadline)
  }
}

/// 剪贴板承诺的兑现者：目标 App 读文本时 pasteboard 服务回到本进程调它，每次调用记一条回执
///
/// 走的是 `declareTypes:owner:` 的非正式协议（`pasteboard:provideDataForType:`），不是
/// `NSPasteboardItemDataProvider`：两者机制相同，前者能直接拿到 changeCount 当还原守卫
final class PromisedTextProvider: NSObject {
  private let text: String
  private(set) var receipts: [Date] = []
  /// 别的进程 clearContents / 写入后为 true：承诺已失效，也不该再写回快照
  private(set) var ownershipLost = false

  init(text: String) {
    self.text = text
  }

  @objc func pasteboard(_ pasteboard: NSPasteboard, provideDataForType type: NSPasteboard.PasteboardType) {
    receipts.append(Date())
    pasteboard.setString(text, forType: type)
  }

  @objc func pasteboardChangedOwner(_ pasteboard: NSPasteboard) {
    ownershipLost = true
  }
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
  let reasonStr = outcome.reason.map { "\"\($0.rawValue)\"" } ?? "null"
  let appStr = outcome.app.map { "\"\(escapeJSON($0))\"" } ?? "null"
  let receiptStr = outcome.receiptMs.map(String.init) ?? "null"
  print("{\"ok\":\(outcome.ok),\"method\":\(methodStr),\"reason\":\(reasonStr),\"app\":\(appStr),"
    + "\"receiptMs\":\(receiptStr),\"receiptCount\":\(outcome.receiptCount)}")
  fflush(stdout)
}

func escapeJSON(_ s: String) -> String {
  return s
    .replacingOccurrences(of: "\\", with: "\\\\")
    .replacingOccurrences(of: "\"", with: "\\\"")
}

main()

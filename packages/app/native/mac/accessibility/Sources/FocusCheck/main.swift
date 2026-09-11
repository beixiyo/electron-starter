import Cocoa
import ApplicationServices

/// 判定前台 App 此刻有没有「文本能落进去的地方」，供调用方决定直接投递还是交回上层 UI 处理
///
/// 分三档，与 `insert-text` 的两条注入路径一一对应：
/// - `editable`：AX 拿到了明确的可写焦点元素，直插与粘贴都能走
/// - `pasteable`：AX 看不见焦点元素，但有焦点窗口且菜单栏挂着标准 Cmd+V，只能走粘贴
/// - `none`：两者都没有，文本没地方去，交回调用方
///
/// 曾经的判定是「焦点元素的 AXRole 必须是 AXTextField / AXTextArea / AXComboBox」，一档定生死。
/// 实测症状：光标停在 VS Code 集成终端里时，文本**有时**投不进终端而被判成没有落点。
/// 根因是 `kAXFocusedUIElementAttribute` 在 Chromium / Electron 系应用上不稳定——同一个
/// VS Code 进程（pid 全程一致、无目标漂移）连续两轮，一轮返回 `AXTextField`
/// 投递成功，一轮返回 `kAXErrorNoValue` 被判成「没有输入框」。原生控件（kitty 实测）则稳定可查
///
/// 而粘贴路径真正依赖的能力是「这个 App 吃不吃 Cmd+V」，恰好就是菜单栏那一项，
/// 它与焦点窗口一样稳定、非前台也查得到。判别力也正好对得上：VS Code / kitty 菜单栏有 Cmd+V
/// （确实能粘），Moonlight 这类串流客户端没有（确实不该粘）
///
/// 治本方向是不再让「AX 能否命名一个可编辑角色」当投递闸门——AX 只用来决定走直插还是粘贴
///
/// stdout 输出 JSON：{"focused":true,"tier":"pasteable","role":"AXWindow","app":"Code",…}
/// `focused` 恒等于 `tier != none`，保留给只关心「投不投」的调用方
/// `--pid=<pid>` 改查指定进程而不是前台 App，用于离线摸各 App 的兼容矩阵——判定同一套，
/// 但注意 `kAXFocusedUIElementAttribute` 对非前台进程本就多半查不到，`editable` 档不具参考性
/// 需要辅助功能权限（与 keyboard-listener 共享同一权限）

/// 单次 AX 请求的上限。目标 App 主线程忙时（终端刷屏最常见）默认要等 6 秒，
/// 足以拖过调用方的 execFile 超时；这里宁可快速失败退到下一档
private let axMessagingTimeout: Float = 0.05
/// 菜单栏递归的最大深度与节点预算，防止病态菜单树把进程拖住
private let menuSearchMaxDepth = 6
private let menuSearchNodeBudget = 400

enum FocusTier: String {
  case editable
  case pasteable
  case none
}

func main() {
  applyGlobalMessagingTimeout()
  print(formatJSON(checkFocusTarget(target: parseTargetPid(CommandLine.arguments))))
  fflush(stdout)
}

/// 把 AX 超时设在 system-wide 对象上，而不是逐个元素设
///
/// `AXUIElementSetMessagingTimeout` 只对被设置的那个对象生效，不会传给它的子元素；
/// 只有设在 system-wide 对象上才是进程级默认值，此后每个没单独设过超时的元素都落到它
///
/// 逐元素设必然漏掉菜单栏递归里的节点——那些节点是从 `AXChildren` 数组直接取出来的，
/// 拿不到任何设置入口。漏掉的后果正是这个超时要防的场景：目标 App 主线程一忙，
/// 菜单树第一个节点就能卡满默认的 6 秒，拖过调用方的 execFile 超时被整个杀掉，
/// 连 app / bundleId / pid 都一起丢，而不是快速退到 none 并保留这些元数据
private func applyGlobalMessagingTimeout() {
  AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), axMessagingTimeout)
}

func parseTargetPid(_ arguments: [String]) -> pid_t? {
  for argument in arguments where argument.hasPrefix("--pid=") {
    return pid_t(String(argument.dropFirst("--pid=".count)))
  }
  return nil
}

func checkFocusTarget(target: pid_t? = nil) -> FocusResult {
  let app = target.flatMap { NSRunningApplication(processIdentifier: $0) }
    ?? NSWorkspace.shared.frontmostApplication
  guard let frontApp = app else {
    return FocusResult(tier: .none, role: nil, app: nil, bundleId: nil, pid: -1, pasteMenuEnabled: nil)
  }

  let appName = frontApp.localizedName
  let bundleId = frontApp.bundleIdentifier
  let pid = Int(frontApp.processIdentifier)
  let appElement = AXUIElementCreateApplication(frontApp.processIdentifier)
  enableEnhancedAccessibilityIfNeeded(appElement)

  let focused = copyElement(appElement, kAXFocusedUIElementAttribute)
  let role = focused.flatMap { stringAttribute($0, kAXRoleAttribute) }
  let subrole = focused.flatMap { stringAttribute($0, kAXSubroleAttribute) }

  /// 密码框永远不是落点：明文写进密码框既写坏内容，也会把文本留在不该留的地方
  if isSecureRole(role: role, subrole: subrole) {
    return FocusResult(tier: .none, role: role, app: appName, bundleId: bundleId, pid: pid, pasteMenuEnabled: nil)
  }

  if let focused, isEditableCandidate(focused, role: role) {
    return FocusResult(tier: .editable, role: role, app: appName, bundleId: bundleId, pid: pid, pasteMenuEnabled: nil)
  }

  /// 焦点元素不可用或不可写时，只要窗口还在、菜单栏挂着标准 Cmd+V，粘贴路径就有落点
  let pasteMenuEnabled = standardPasteMenuState(appElement)
  let hasWindow = copyElement(appElement, kAXFocusedWindowAttribute) != nil
  if hasWindow, pasteMenuEnabled != nil {
    return FocusResult(tier: .pasteable, role: role, app: appName, bundleId: bundleId, pid: pid, pasteMenuEnabled: pasteMenuEnabled)
  }

  return FocusResult(tier: .none, role: role, app: appName, bundleId: bundleId, pid: pid, pasteMenuEnabled: pasteMenuEnabled)
}

/// 打开 Chromium / Electron 的完整 AX 树；已经开着就不再写
///
/// `AXEnhancedUserInterface` 对 Chromium 是「重建整棵 AX 树」的开关，每次调用都无条件写会让
/// 紧接着的焦点查询更慢、更容易落空。先读后写只在真正需要时付这个代价
private func enableEnhancedAccessibilityIfNeeded(_ appElement: AXUIElement) {
  var current: AnyObject?
  let alreadyEnabled = AXUIElementCopyAttributeValue(appElement, "AXEnhancedUserInterface" as CFString, &current) == .success
    && (current as? Bool) == true
  if alreadyEnabled { return }

  /// Electron 官方开关（Electron 24+ 修复），与 Chromium 原生的 EnhancedUserInterface 覆盖面不同，两个都写
  AXUIElementSetAttributeValue(appElement, "AXManualAccessibility" as CFString, kCFBooleanTrue)
  AXUIElementSetAttributeValue(appElement, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
}

/// 可写焦点元素的判定
///
/// 主判据是「选区可写」而不是 role 白名单：写 AXSelectedText 等价于在光标处插入，
/// 这个能力与控件叫什么名字无关，自定义控件也可能具备。role 白名单只作为补充，
/// 覆盖那些选区不可写、但整体 AXValue 可写的老式控件
func isEditableCandidate(_ element: AXUIElement, role: String?) -> Bool {
  if isSettable(element, kAXSelectedTextAttribute) || isSettable(element, kAXSelectedTextRangeAttribute) {
    return true
  }
  let textRoles: Set<String> = [
    kAXTextFieldRole as String,
    kAXTextAreaRole as String,
    kAXComboBoxRole as String,
    "AXSearchField",
  ]
  guard let role, textRoles.contains(role) else { return false }
  return isSettable(element, kAXValueAttribute)
}

func isSecureRole(role: String?, subrole: String?) -> Bool {
  [role, subrole]
    .compactMap { $0?.lowercased() }
    .contains { $0.contains("secure") || $0.contains("password") }
}

/// 菜单栏里标准粘贴命令（Cmd+V，无附加修饰键）的启用状态
///
/// 返回 `nil` 表示这个 App 根本没有标准粘贴命令——Moonlight 这类串流 / 游戏客户端就是如此，
/// 它们不该被当成粘贴落点。返回 `false` 只是「此刻报告为禁用」，不作为拒绝依据：
/// 不少私有编辑器照常接受 Cmd+V 却长期把菜单项报成禁用，这一项是弱证据，只留给诊断
func standardPasteMenuState(_ appElement: AXUIElement) -> Bool? {
  guard let menuBar = copyElement(appElement, kAXMenuBarAttribute) else { return nil }
  var budget = menuSearchNodeBudget
  return findPasteMenuItem(menuBar, depth: 0, budget: &budget)
}

private func findPasteMenuItem(_ element: AXUIElement, depth: Int, budget: inout Int) -> Bool? {
  guard depth <= menuSearchMaxDepth, budget > 0 else { return nil }
  budget -= 1

  if stringAttribute(element, kAXRoleAttribute) == (kAXMenuItemRole as String),
     stringAttribute(element, kAXMenuItemCmdCharAttribute)?.caseInsensitiveCompare("v") == .orderedSame,
     numberAttribute(element, kAXMenuItemCmdModifiersAttribute) == 0 {
    return boolAttribute(element, kAXEnabledAttribute) ?? true
  }

  var childrenRef: AnyObject?
  guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef) == .success,
        let children = childrenRef as? [AXUIElement] else { return nil }
  for child in children {
    if let state = findPasteMenuItem(child, depth: depth + 1, budget: &budget) { return state }
  }
  return nil
}

// MARK: - AX 读取

func copyElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
  var ref: AnyObject?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &ref) == .success,
        let ref, CFGetTypeID(ref) == AXUIElementGetTypeID() else { return nil }
  return (ref as! AXUIElement)
}

func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
  var ref: AnyObject?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &ref) == .success else { return nil }
  return ref as? String
}

func boolAttribute(_ element: AXUIElement, _ attribute: String) -> Bool? {
  var ref: AnyObject?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &ref) == .success else { return nil }
  return ref as? Bool
}

func numberAttribute(_ element: AXUIElement, _ attribute: String) -> Int? {
  var ref: AnyObject?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &ref) == .success else { return nil }
  return (ref as? NSNumber)?.intValue
}

func isSettable(_ element: AXUIElement, _ attribute: String) -> Bool {
  var settable: DarwinBoolean = false
  return AXUIElementIsAttributeSettable(element, attribute as CFString, &settable) == .success && settable.boolValue
}

// MARK: - 输出

struct FocusResult {
  let tier: FocusTier
  let role: String?
  let app: String?
  let bundleId: String?
  let pid: Int
  /// 菜单栏标准 Cmd+V 的启用状态，仅供诊断；判定只看它存不存在
  let pasteMenuEnabled: Bool?
}

func formatJSON(_ r: FocusResult) -> String {
  let roleStr = r.role.map { "\"\(escapeJSON($0))\"" } ?? "null"
  let appStr = r.app.map { "\"\(escapeJSON($0))\"" } ?? "null"
  let bundleIdStr = r.bundleId.map { "\"\(escapeJSON($0))\"" } ?? "null"
  let pasteStr = r.pasteMenuEnabled.map { $0 ? "true" : "false" } ?? "null"
  return "{\"focused\":\(r.tier != .none),\"tier\":\"\(r.tier.rawValue)\",\"role\":\(roleStr),"
    + "\"app\":\(appStr),\"bundleId\":\(bundleIdStr),\"pid\":\(r.pid),\"pasteMenuEnabled\":\(pasteStr)}"
}

func escapeJSON(_ s: String) -> String {
  return s
    .replacingOccurrences(of: "\\", with: "\\\\")
    .replacingOccurrences(of: "\"", with: "\\\"")
}

main()

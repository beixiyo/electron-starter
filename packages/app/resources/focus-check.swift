import Cocoa
import ApplicationServices

/// 检测系统全局是否有聚焦的文本输入元素
/// 通过 macOS Accessibility API 获取当前焦点应用的焦点元素，判断其 AXRole
/// stdout 输出 JSON: {"focused": true/false, "role": "AXTextField", "app": "Code"}
/// 需要辅助功能权限（与 fn-listener 共享同一权限）

func main() {
  let result = checkFocusedTextInput()
  let json = formatJSON(result)
  print(json)
  fflush(stdout)
}

func checkFocusedTextInput() -> FocusResult {
  guard let frontApp = NSWorkspace.shared.frontmostApplication else {
    return FocusResult(focused: false, role: nil, app: nil, bundleId: nil, pid: -1)
  }

  let appName = frontApp.localizedName
  let bundleId = frontApp.bundleIdentifier
  let pid = Int(frontApp.processIdentifier)
  let appElement = AXUIElementCreateApplication(frontApp.processIdentifier)

  // 对 Electron / Chromium 应用启用完整 AX 树
  // AXManualAccessibility: Electron 官方属性（Electron 24+ 修复）
  // AXEnhancedUserInterface: Chromium 原生属性（VoiceOver 使用，覆盖自定义 Chromium 如飞书）
  AXUIElementSetAttributeValue(appElement, "AXManualAccessibility" as CFString, kCFBooleanTrue)
  AXUIElementSetAttributeValue(appElement, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)

  var focusedElementRef: AnyObject?
  guard AXUIElementCopyAttributeValue(
    appElement,
    kAXFocusedUIElementAttribute as CFString,
    &focusedElementRef
  ) == .success else {
    return FocusResult(focused: false, role: nil, app: appName, bundleId: bundleId, pid: pid)
  }

  let focusedElement = focusedElementRef as! AXUIElement

  var roleRef: AnyObject?
  guard AXUIElementCopyAttributeValue(
    focusedElement,
    kAXRoleAttribute as CFString,
    &roleRef
  ) == .success, let role = roleRef as? String else {
    return FocusResult(focused: false, role: nil, app: appName, bundleId: bundleId, pid: pid)
  }

  let textRoles: Set<String> = [
    kAXTextFieldRole,   // AXTextField
    kAXTextAreaRole,    // AXTextArea
    kAXComboBoxRole,    // AXComboBox
  ]

  let isText = textRoles.contains(role)
  return FocusResult(focused: isText, role: role, app: appName, bundleId: bundleId, pid: pid)
}

struct FocusResult {
  let focused: Bool
  let role: String?
  let app: String?
  let bundleId: String?
  let pid: Int
}

func formatJSON(_ r: FocusResult) -> String {
  let roleStr = r.role.map { "\"\($0)\"" } ?? "null"
  let appStr = r.app.map { "\"\(escapeJSON($0))\"" } ?? "null"
  let bundleIdStr = r.bundleId.map { "\"\(escapeJSON($0))\"" } ?? "null"
  return "{\"focused\":\(r.focused),\"role\":\(roleStr),\"app\":\(appStr),\"bundleId\":\(bundleIdStr),\"pid\":\(r.pid)}"
}

func escapeJSON(_ s: String) -> String {
  return s
    .replacingOccurrences(of: "\\", with: "\\\\")
    .replacingOccurrences(of: "\"", with: "\\\"")
}

main()

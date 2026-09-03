import Cocoa
import CoreGraphics

/// 定位「系统设置」主窗口在全局屏幕坐标中的位置
/// stdout 输出 JSON: {"found":true,"x":0,"y":0,"width":0,"height":0,"sheet":false,"owner":"System Settings"}
///
/// 只读 CGWindowListCopyWindowInfo 的窗口几何与所属进程名，**不需要任何权限**：
/// 辅助功能与屏幕录制只影响 kCGWindowName（窗口标题），本文件从不读取它
/// 因此本 helper 可以在「用户尚未授予辅助功能」时使用——权限引导浮窗正是这个场景，
/// 用 AXUIElement 读系统设置窗口树则会陷入「要先有权限才能引导用户给权限」的死循环
///
/// `--dump` 列出该进程所有在屏窗口的层级与矩形，用于排查 sheet / 弹层的归属
func main() {
  if CommandLine.arguments.contains("--dump") {
    print(dumpJSON(settingsWindows()))
    fflush(stdout)
    return
  }

  let result = locateSystemSettingsWindow()
  print(formatJSON(result))
  fflush(stdout)
}

/// 系统设置在 Ventura 改名，旧版仍叫 System Preferences；bundle id 两代一致
private let systemSettingsBundleId = "com.apple.systempreferences"

/// 主窗口至少要有这个尺寸；过滤掉尚未完成布局的空壳窗口，避免浮窗贴到一个 1x1 的坐标上
private let minMainWindowSide = 200.0
/// sheet 的判定下限；密码 / Touch ID 确认 sheet 远大于此，只是排除工具提示这类碎片
private let minSheetSide = 100.0

/// 系统设置进程当前在屏的全部窗口，按前后顺序（越靠前越接近最前面）
func settingsWindows() -> [[String: Any]] {
  let pids = NSWorkspace.shared.runningApplications
    .filter { $0.bundleIdentifier == systemSettingsBundleId }
    .map { $0.processIdentifier }

  guard !pids.isEmpty else { return [] }

  // optionOnScreenOnly 是有意的：系统设置被最小化或切到别的 Space 时应视为「不在」，
  // 调用方据此收掉引导卡片，而不是让它继续浮在一个没有系统设置的桌面上
  let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
  guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    return []
  }

  return windows.filter { window in
    guard let ownerPid = window[kCGWindowOwnerPID as String] as? pid_t else { return false }
    return pids.contains(ownerPid)
  }
}

func locateSystemSettingsWindow() -> WindowResult {
  var candidates: [(bounds: WindowBounds, owner: String?)] = []

  for window in settingsWindows() {
    // layer 0 才是普通文档窗口；工具提示、菜单都在更高层
    // 密码 / Touch ID 确认 sheet 也是系统设置自己的 layer-0 窗口，同样会进到这里
    guard let layer = window[kCGWindowLayer as String] as? Int, layer == 0 else { continue }
    guard let boundsDict = window[kCGWindowBounds as String] as? [String: Any],
          let bounds = parseBounds(boundsDict) else { continue }
    guard bounds.width >= minSheetSide, bounds.height >= minSheetSide else { continue }

    candidates.append((bounds, window[kCGWindowOwnerName as String] as? String))
  }

  // 主窗口取面积最大的那个，而不是排在最前面的那个：
  // sheet 弹出时它才是最前面的窗口，按前后顺序取会把卡片贴到 sheet 上，正好盖住输入框
  guard let main = candidates.max(by: { $0.bounds.area < $1.bounds.area }),
        main.bounds.width >= minMainWindowSide, main.bounds.height >= minMainWindowSide else {
    return WindowResult(found: false, bounds: nil, sheetPresented: false, owner: nil)
  }

  // 主窗口之外还有落在其范围内的窗口，即有 sheet 挂着；调用方据此把卡片藏起来让位
  let sheetPresented = candidates.contains { candidate in
    candidate.bounds.area < main.bounds.area && main.bounds.contains(candidate.bounds)
  }

  return WindowResult(found: true, bounds: main.bounds, sheetPresented: sheetPresented, owner: main.owner)
}

func parseBounds(_ dict: [String: Any]) -> WindowBounds? {
  guard let x = dict["X"] as? Double,
        let y = dict["Y"] as? Double,
        let width = dict["Width"] as? Double,
        let height = dict["Height"] as? Double else { return nil }
  return WindowBounds(x: x, y: y, width: width, height: height)
}

struct WindowBounds {
  let x: Double
  let y: Double
  let width: Double
  let height: Double

  var area: Double { width * height }

  func contains(_ other: WindowBounds) -> Bool {
    return other.x >= x && other.y >= y
      && other.x + other.width <= x + width
      && other.y + other.height <= y + height
  }
}

struct WindowResult {
  let found: Bool
  let bounds: WindowBounds?
  let sheetPresented: Bool
  let owner: String?
}

func formatJSON(_ r: WindowResult) -> String {
  guard r.found, let b = r.bounds else {
    return "{\"found\":false}"
  }
  let ownerStr = r.owner.map { "\"\(escapeJSON($0))\"" } ?? "null"
  return "{\"found\":true,\"x\":\(round(b.x)),\"y\":\(round(b.y)),"
    + "\"width\":\(round(b.width)),\"height\":\(round(b.height)),"
    + "\"sheet\":\(r.sheetPresented),\"owner\":\(ownerStr)}"
}

/// `--dump` 输出：每个窗口的层级、矩形与 alpha，便于人工核对 sheet 的形态
func dumpJSON(_ windows: [[String: Any]]) -> String {
  let items = windows.map { window -> String in
    let layer = window[kCGWindowLayer as String] as? Int ?? -1
    let alpha = window[kCGWindowAlpha as String] as? Double ?? -1
    let bounds = (window[kCGWindowBounds as String] as? [String: Any]).flatMap(parseBounds)
    let rect = bounds.map { "\"x\":\($0.x),\"y\":\($0.y),\"width\":\($0.width),\"height\":\($0.height)" }
      ?? "\"x\":null,\"y\":null,\"width\":null,\"height\":null"
    return "{\"layer\":\(layer),\"alpha\":\(alpha),\(rect)}"
  }
  return "[" + items.joined(separator: ",") + "]"
}

func escapeJSON(_ s: String) -> String {
  return s
    .replacingOccurrences(of: "\\", with: "\\\\")
    .replacingOccurrences(of: "\"", with: "\\\"")
}

main()

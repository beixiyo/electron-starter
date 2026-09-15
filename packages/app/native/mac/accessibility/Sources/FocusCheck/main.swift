import Cocoa
import ApplicationServices
import Carbon.HIToolbox

/// 判定前台 App 此刻有没有「文本能落进去的地方」，供调用方决定直接投递还是交回上层 UI 处理
///
/// 分三档，与 `insert-text` 的两条注入路径一一对应：
/// - `editable`：AX 拿到了明确的可写焦点元素，直插与粘贴都能走
/// - `pasteable`：AX 只报出一个原生容器（`AXWindow` / `AXGroup`）或 `aria-activedescendant` 指向的列表行，
///   但有焦点窗口且菜单栏挂着标准 Cmd+V，只能走粘贴
/// - `none`：两者都没有，或 AX 明确报出焦点落在没有文本插入点的控件上；`reason` 说明是哪条
///
/// **AX 是外部投递唯一的闸门。曾试过把闸门换成剪贴板读回执，实测证明不可行：**
/// `insert-text` 用 `declareTypes:owner:` 惰性承诺 + Cmd+V，目标读剪贴板才回调。设想是「没落点的目标不会读」，
/// 结果 Chrome 焦点在 body（页面无 paste 监听）32 ms 就读了、Safari 空白页 0 ms 读了、系统设置侧栏
/// （`AXOutline`）138 ms 也读了，文本全都没落——菜单项校验、SwiftUI 粘贴命令、Chromium 构建 paste 事件都会读
/// 剪贴板。实测连续三次文本无声消失，就是那版的代价。回执只有反向推理成立：
/// 没人读一定没落（`insert-text` 报 `paste-not-consumed`，调用方视为没有落点），有人读证明不了什么
/// 所以 AX 仍是唯一能回答「Cmd+V 会不会被吃」的信号，判定必须偏保守：宁可判成没有落点，不盲粘
///
/// 曾经的判定是「焦点元素的 AXRole 必须是 AXTextField / AXTextArea / AXComboBox」，一档定生死
/// 实测症状：光标停在 VS Code 集成终端里时，文本**有时**投不进终端而被判成没有落点
/// 根因是 `kAXFocusedUIElementAttribute` 在 Chromium / Electron 系应用上不稳定——同一个
/// VS Code 进程（pid 全程一致、无目标漂移）连续两轮，一轮返回 `AXTextField`
/// 投递成功，一轮返回 `kAXErrorNoValue` 被判成「没有输入框」。于是加了第二档：
/// 焦点拿不到时只看窗口与菜单栏 Cmd+V，赌一次粘贴
///
/// 但 `pasteable` 不能只看窗口与菜单。实测症状：前台是访达桌面时按下投递，文本不知去向
/// 判定结果是 `pasteable role=AXOutline`：访达随时有焦点窗口、菜单栏也挂着 Cmd+V，于是文本被
/// Cmd+V「粘」进桌面——Finder 对文本粘贴无动作，投递却判成功，剪贴板随后还原，整段文本就此丢失
/// 这比误判成没有落点严重得多，后者调用方至少还能把文本留给用户。同一批症状还有第二种：
/// Chrome 页面 body、VS Code 资源管理器以外的非输入区域按下投递，也是文本消失——Chromium 把它们
/// 报成 `AXWebArea` / `AXGroup`，当时被当成「可能藏着光标的容器」放进了粘贴档
///
/// 根因用探针逐场景实测（Chrome 测试页 + 独立 user-data-dir 的 VS Code，`kAXFocusedUIElementAttribute`
/// 每 120 ms 采样）后有两条：
/// 1. **Chromium 热状态下从不把光标藏进容器。** 有光标必报可编辑角色且 `AXSelectedText` 可写：
///    普通 input / textarea / contenteditable、模拟 xterm 的零尺寸隐藏 textarea、`aria-hidden` 子树里的
///    textarea、同源与跨源 iframe 里的 textarea、VS Code 终端（`xterm-helper-textarea`，刷屏中连续 6 次采样
///    稳定）、Monaco 编辑器（`native-edit-context`）全部如此。报出 `AXWebArea`（body）、`AXGroup`
///    （tabindex div）、`AXOutline`（资源管理器）时就是没有光标
/// 2. **当年那个 `kAXErrorNoValue` 是冷启动窗口，不是稳定形态。** Chromium 首次被打开完整 AX 树
///    （或自动休眠后再被唤醒）后约 2 s 内焦点查询一律 noValue，期间偶见 cannotComplete（主线程忙）；
///    fresh VS Code 实测 2140 ms 后才变成 `AXWebArea`，树热了以后 37 ms 就能拿到。旧代码每次调用都
///    无条件重写 `AXEnhancedUserInterface` 触发重建，正好反复撞进这个窗口
///
/// 后续又补了两条：
/// 3. **Chromium 对所有表单控件都把 `AXSelectedText` / `AXSelectedTextRange` / `AXValue` 报成可写。**
///    `<input type=range>`（`AXSlider`）、color、checkbox、`<select>`、date 全是 Y，「选区可写」在
///    Chromium 上没有判别力；`AXEditableAncestor` 才准：真正的文本控件（含 number、hidden textarea、
///    contenteditable、`role=textbox`）返回自身，其余 noValue。只读输入框反过来：有 ancestor 但
///    `AXSelectedText` 不可写。WebKit（Safari）则**不提供** `AXEditableAncestor`（textarea 也 noValue），
///    但它的选区可写性本身是准的（range 报 n、只读 `AXValue` 报 n）。实测在 Chrome 里连续两次文本消失，
///    是一个自定义下拉组件（`role="combobox"`）的触发器被角色白名单放了进来后，insert-text 的 AX 直写
///    因 AXValue 不是字符串跳过了「内容变没变」校验，直接判成功，文本消失
/// 4. **冷启动窗口不止 2 s。** 带扩展、正在启动的真实 VS Code 在预热后 3.3 s 仍 noValue（prewarm 与
///    正式判定两次都等满 600 ms），当时落进粘贴档盲粘，文本消失。noValue 赌粘贴没有任何一例受益的证据：
///    热态 Chromium 有光标必有元素，AppKit 自绘控件当第一响应者时报的是 `AXWindow` / `AXGroup` 而不是空
///
/// 所以判定是两条并行的边界：
/// - 焦点元素是 **Web 内容节点**（`AXDOMIdentifier` 读到 success，Blink / WebKit 没有 id 也返回空串，
///   Chrome 自己的 Views 控件如地址栏也带 `view_N`）时：可编辑 = `AXSelectedText` 可写，且
///   （`AXEditableAncestor` 有值，或 `AXInsertionPointLineNumber` 是有效行号且 `AXValue` 可写）——
///   前半条给 Chromium，后半条给 WebKit，细节见 `isWebContentEditable`；
///   其余一律 `none`，唯一例外是 `AXStaticText`——`aria-activedescendant` 会让 Chromium 把焦点报成
///   列表里那一行（VS Code 命令面板、Monaco 补全列表），真焦点仍在输入框里，粘贴能进，留给第二档
/// - 焦点元素是原生控件时沿用「选区可写 / 角色白名单」与角色表：列表 / 表格 / 按钮这类不可能有插入点的
///   判 `none`，`AXWindow` / `AXGroup` 这类原生容器仍留给粘贴档赌一次（自绘控件当第一响应者就长这样）
/// - 焦点元素拿不到（noValue / cannotComplete）时在预算内轮询等一等，覆盖冷启动的尾巴；
///   大头由调用方在按下的那一刻预热（`focus-check.ts` 的 `prewarmExternalFocusCheck`）
///   等完仍拿不到就 `none`：宁可判成没有落点，不再盲粘
/// - 密码框先看系统级安全输入（`IsSecureEventInputEnabled`，密码框聚焦时 AppKit / Chromium / Safari 都会打开，
///   与 AX 树冷热无关），再看 AX 角色含 secure / password
/// - 访达整体不进第二档：它唯一的文本落点（重命名、搜索框）都会被第一档直接命中，
///   而侧栏 / 预览等区域实测还会报出 `AXGroup`，单靠角色表挡不住
///
/// **查哪个 App 不只看前台。** 系统「表情与符号」面板（`com.apple.CharacterPaletteIM`）是输入法助手进程的
/// 非激活面板：点进它的搜索框后键盘输入归它，但 `frontmostApplication` 与背后 App 的 AX 焦点都纹丝不动
/// （实测：面板搜索框有光标时前台仍是访达、焦点仍是桌面的 `AXOutline`，对面板进程单独查却是 `AXTextField`
/// 可写）。只查前台 App 永远摸不到它，转写只能弹结果条；所以先看面板进程有没有键盘焦点，有就改查它，
/// 判定与投递（`insert-text` 同一条规则）都落到面板的搜索框。面板关掉或点回背后 App 后它的焦点元素
/// 查不到，自然退回前台 App
///
/// stdout 输出 JSON：{"focused":true,"tier":"pasteable","reason":null,"role":"AXWindow","app":"Code","web":false,"waitMs":0,…}
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
/// 焦点元素拿不到时的轮询预算与间隔
///
/// 只覆盖 Chromium 冷启动窗口的尾巴：调用方在按下那一刻已经预热过，走到这里通常已经热了；
/// 真正冷（按住不到一秒就松手，或 App 还在启动）时多等 600 ms 换一次准确判定，等不到就交回调用方
/// 原生 App 焦点确实查不到的场景会白等这一段，接受
private let focusedElementWaitBudget: TimeInterval = 0.6
private let focusedElementPollInterval: useconds_t = 50_000

enum FocusTier: String {
  case editable
  case pasteable
  case none
}

/// `none` 的原因，与调用方 `FocusCheckResult.reason` 一一对应
enum FocusNoneReason: String {
  case noFrontmostApp = "no-frontmost-app"
  case secureInput = "secure-input"
  case secureField = "secure-field"
  /// 等满预算仍拿不到焦点元素（Chromium 冷启动窗口，或 App 关掉了无障碍）
  case focusUnavailable = "focus-unavailable"
  /// Web 内容节点报出非可编辑角色：Chromium 热态有光标必报可编辑角色，容器 / 按钮 / 表单控件就是没有光标
  case webNotEditable = "web-not-editable"
  /// 原生控件角色明确没有插入点（列表 / 表格 / 按钮 …）
  case noCaretRole = "no-caret-role"
  case excludedApp = "excluded-app"
  /// 菜单栏读不到、没扫完或确定没有标准 Cmd+V
  case noPasteMenu = "no-paste-menu"
  case noFocusedWindow = "no-focused-window"
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
    ?? characterPaletteWithKeyboardFocus()
    ?? NSWorkspace.shared.frontmostApplication
  guard let frontApp = app else {
    return FocusResult(
      tier: .none, reason: .noFrontmostApp, role: nil, app: nil, bundleId: nil, pid: -1,
      isWebContent: false, waitMs: 0, pasteMenuEnabled: nil,
    )
  }

  let appName = frontApp.localizedName
  let bundleId = frontApp.bundleIdentifier
  let pid = Int(frontApp.processIdentifier)
  let appElement = AXUIElementCreateApplication(frontApp.processIdentifier)
  enableEnhancedAccessibilityIfNeeded(appElement)

  let (focused, waitMs) = waitForFocusedElement(appElement)
  let role = focused.flatMap { stringAttribute($0, kAXRoleAttribute) }
  let subrole = focused.flatMap { stringAttribute($0, kAXSubroleAttribute) }
  let isWebContent = focused.map(isWebContentNode) ?? false

  func result(_ tier: FocusTier, reason: FocusNoneReason? = nil, pasteMenuEnabled: Bool? = nil) -> FocusResult {
    FocusResult(
      tier: tier, reason: reason, role: role, app: appName, bundleId: bundleId, pid: pid,
      isWebContent: isWebContent, waitMs: waitMs, pasteMenuEnabled: pasteMenuEnabled,
    )
  }

  /// 密码框永远不是落点：明文写进密码框既写坏内容，也会把文本留在不该留的地方
  if IsSecureEventInputEnabled() {
    return result(.none, reason: .secureInput)
  }
  if isSecureRole(role: role, subrole: subrole) {
    return result(.none, reason: .secureField)
  }

  /// 等完预算还拿不到焦点元素：不赌粘贴，见文件头第 4 条
  guard let focused else {
    return result(.none, reason: .focusUnavailable)
  }

  let editable = isWebContent
    ? isWebContentEditable(focused)
    : isEditableCandidate(focused, role: role)
  if editable {
    return result(.editable)
  }

  /// AX 已经说清了焦点在哪、且那里放不下光标，或这个 App 根本没有粘贴落点：不赌粘贴
  if isWebContent, !canWebContentNodeHideCaret(role: role) {
    return result(.none, reason: .webNotEditable)
  }
  if !isWebContent, !canNativeElementHideCaret(role: role) {
    return result(.none, reason: .noCaretRole)
  }
  if isPasteTargetExcluded(bundleId: bundleId) {
    return result(.none, reason: .excludedApp)
  }

  /// 焦点藏在原生容器里时，只要窗口还在、菜单栏挂着标准 Cmd+V，粘贴路径就有落点
  let pasteMenu = standardPasteMenuState(appElement)
  guard case .present(let pasteMenuEnabled) = pasteMenu else {
    return result(.none, reason: .noPasteMenu)
  }
  guard copyElement(appElement, kAXFocusedWindowAttribute) != nil else {
    return result(.none, reason: .noFocusedWindow, pasteMenuEnabled: pasteMenuEnabled)
  }
  return result(.pasteable, pasteMenuEnabled: pasteMenuEnabled)
}

/// 系统「表情与符号」面板的输入法助手进程
let characterPaletteBundleId = "com.apple.CharacterPaletteIM"

/// 键盘焦点此刻落在「表情与符号」面板里时返回该进程，否则 nil；见文件头「查哪个 App 不只看前台」
///
/// 只问面板进程自己的 `kAXFocusedUIElementAttribute`：非激活面板成为 key window 时它报出搜索框，
/// 失去 key 或面板收起后 noValue。焦点在面板里但不在搜索框上（如落在表情网格）同样改查它——
/// 此时键盘输入归面板，往背后 App 粘只会粘错地方，让后面的角色判定去弹结果条
/// 与 `insert-text` 的同名函数保持一致
func characterPaletteWithKeyboardFocus() -> NSRunningApplication? {
  for app in NSRunningApplication.runningApplications(withBundleIdentifier: characterPaletteBundleId) {
    var ref: AnyObject?
    let element = AXUIElementCreateApplication(app.processIdentifier)
    if AXUIElementCopyAttributeValue(element, kAXFocusedUIElementAttribute as CFString, &ref) == .success,
       let ref, CFGetTypeID(ref) == AXUIElementGetTypeID() {
      return app
    }
  }
  return nil
}

/// 取焦点元素；拿不到（noValue / cannotComplete）时在预算内轮询
///
/// 返回实际等待的毫秒数供诊断：`waitMs` 大于 0 说明这一轮撞上了冷启动窗口，
/// 排「明明在输入框里却被判成没有落点」时先看它
func waitForFocusedElement(_ appElement: AXUIElement) -> (element: AXUIElement?, waitMs: Int) {
  let deadline = Date().addingTimeInterval(focusedElementWaitBudget)
  let started = Date()
  while true {
    var ref: AnyObject?
    let error = AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &ref)
    let waited = Int(Date().timeIntervalSince(started) * 1000)
    if error == .success, let ref, CFGetTypeID(ref) == AXUIElementGetTypeID() {
      return ((ref as! AXUIElement), waited)
    }
    let retryable = error == .noValue || error == .cannotComplete
    if !retryable || Date() >= deadline {
      return (nil, waited)
    }
    usleep(focusedElementPollInterval)
  }
}

/// 焦点元素是否是 Blink / WebKit 暴露的 DOM 节点
///
/// 两家引擎给每个 DOM 节点都挂 `AXDOMIdentifier`，没有 id 也返回 success 的空串；AppKit 控件报
/// attributeUnsupported。只认 success：两家引擎对**任何**不认识的属性名都回 noValue（实测
/// `AXEditableAncestor` 不在 Chromium 的属性名清单里照样回 noValue），noValue 不代表「支持」
func isWebContentNode(_ element: AXUIElement) -> Bool {
  var ref: AnyObject?
  return AXUIElementCopyAttributeValue(element, "AXDOMIdentifier" as CFString, &ref) == .success
}

/// Web 内容节点的可写判定；实测矩阵见文件头第 3 条
///
/// - Chromium：所有表单控件的选区与值都报可写，只能看 `AXEditableAncestor` 有没有值（含自身）
/// - WebKit：`AXEditableAncestor` 不含自身（textarea 也 noValue），改看 `AXInsertionPointLineNumber`——
///   有光标的元素给行号，没有的报 noValue；再要求 `AXValue` 可写挡住只读 textarea（它也有行号）
/// - 第二条不能换成角色白名单：`<div role="combobox">` / `<button role="combobox">` 在 Chromium 上是
///   `AXComboBox` 且选区、值全报可写，只有行号是 NSIntegerMax。实测那次连丢两次文本，
///   就是自定义下拉组件的触发器被角色白名单放了进来
func isWebContentEditable(_ element: AXUIElement) -> Bool {
  guard isSettable(element, kAXSelectedTextAttribute) else { return false }
  if copyElement(element, "AXEditableAncestor") != nil { return true }

  guard let line = numberAttribute(element, kAXInsertionPointLineNumberAttribute), line != Int.max else { return false }
  return isSettable(element, kAXValueAttribute)
}

/// Web 内容节点是否还可能藏着光标
///
/// 实测 Chromium 有光标时必报可编辑角色（见文件头），所以走到这里的非可编辑角色就是没有光标
/// 唯一放行的是 `AXStaticText`：`aria-activedescendant` 会让焦点被报成列表里那一行
/// （VS Code 命令面板 / Monaco 补全列表实测 `monaco-list-row`），真焦点仍在输入框里
func canWebContentNodeHideCaret(role: String?) -> Bool {
  role == (kAXStaticTextRole as String)
}

/// 原生控件的角色是否还可能藏着一个 AX 看不见的光标
///
/// 焦点落在 `AXWindow` / `AXGroup` 这类原生容器上时，自绘控件可能确实把光标藏在里面
/// （不实现 AX 的自定义 NSView 当第一响应者，AppKit 就报到窗口或所在容器），这些交给粘贴路径去赌
/// 列表、表格、按钮、图片这类控件则不可能有插入点：AX 既然点了名，就照它说的办
/// 角色读不到（`nil`）时同样放行——元素在、角色缺，仍是「看不透」而不是「没光标」
/// 只列**确定**没有插入点的角色——列错一个就会把某类 App 的粘贴投递变回没有落点
/// Web 内容节点不走这张表，见 {@link canWebContentNodeHideCaret}
func canNativeElementHideCaret(role: String?) -> Bool {
  guard let role else { return true }
  let nonTextRoles: Set<String> = [
    kAXListRole as String,
    kAXOutlineRole as String,
    kAXTableRole as String,
    kAXBrowserRole as String,
    kAXGridRole as String,
    kAXRowRole as String,
    kAXCellRole as String,
    kAXColumnRole as String,
    kAXImageRole as String,
    kAXButtonRole as String,
    kAXCheckBoxRole as String,
    kAXRadioButtonRole as String,
    kAXRadioGroupRole as String,
    kAXPopUpButtonRole as String,
    kAXMenuButtonRole as String,
    kAXMenuBarRole as String,
    kAXMenuRole as String,
    kAXMenuItemRole as String,
    kAXSliderRole as String,
    kAXIncrementorRole as String,
    kAXScrollBarRole as String,
    kAXTabGroupRole as String,
    kAXToolbarRole as String,
    "AXLink",
    kAXDisclosureTriangleRole as String,
    kAXColorWellRole as String,
    kAXProgressIndicatorRole as String,
    kAXBusyIndicatorRole as String,
    kAXLevelIndicatorRole as String,
    kAXValueIndicatorRole as String,
    kAXRelevanceIndicatorRole as String,
    kAXHandleRole as String,
    kAXDockItemRole as String,
  ]
  return !nonTextRoles.contains(role)
}

/// 没有任何文本落点的 App，不进粘贴档
///
/// 访达：桌面就是它的窗口，Cmd+V 只认文件，文本粘进去无声无息；重命名 / 搜索这些真正的
/// 文本框会被 `editable` 档直接命中，不需要粘贴档兜底
func isPasteTargetExcluded(bundleId: String?) -> Bool {
  bundleId == "com.apple.finder"
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

/// 原生控件的可写判定；Web 内容节点走 {@link isWebContentEditable}
///
/// 主判据是「选区可写」而不是 role 白名单：写 AXSelectedText 等价于在光标处插入，
/// 这个能力与控件叫什么名字无关，自定义控件也可能具备。role 白名单只作为补充，
/// 覆盖那些选区不可写、但整体 AXValue 可写的老式控件
/// 这条对 Chromium 不成立（滑块、复选框也报选区可写），所以只留给原生控件
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

// MARK: - 菜单栏 Cmd+V

/// 菜单栏里标准粘贴命令（Cmd+V，无附加修饰键）的状态
enum PasteMenuState {
  /// 找到了；`enabled` 只是此刻报告的启用状态，不作为拒绝依据：
  /// 不少私有编辑器照常接受 Cmd+V 却长期把菜单项报成禁用，这一项是弱证据，只留给诊断
  case present(enabled: Bool)
  /// 菜单栏读到了、整棵树扫完了、确定没有——Moonlight 这类串流 / 游戏客户端就是如此
  case absent
  /// 菜单栏读不到，或扫描因 AX 超时 / 预算耗尽没扫完。与 `absent` 同样不进粘贴档（粘贴档本就是赌，证据不足不赌），
  /// 分开只为诊断
  case unknown
}

func standardPasteMenuState(_ appElement: AXUIElement) -> PasteMenuState {
  guard let menuBar = copyElement(appElement, kAXMenuBarAttribute) else { return .unknown }
  var scan = MenuScan(budget: menuSearchNodeBudget, incomplete: false)
  if let enabled = findPasteMenuItem(menuBar, depth: 0, scan: &scan) {
    return .present(enabled: enabled)
  }
  return scan.incomplete
    ? .unknown
    : .absent
}

private struct MenuScan {
  var budget: Int
  /// 有节点因 AX 出错（超时、进程忙）或预算 / 深度耗尽没有展开：找不到不等于没有
  var incomplete: Bool
}

private func findPasteMenuItem(_ element: AXUIElement, depth: Int, scan: inout MenuScan) -> Bool? {
  guard depth <= menuSearchMaxDepth, scan.budget > 0 else {
    scan.incomplete = true
    return nil
  }
  scan.budget -= 1

  if stringAttribute(element, kAXRoleAttribute) == (kAXMenuItemRole as String),
     stringAttribute(element, kAXMenuItemCmdCharAttribute)?.caseInsensitiveCompare("v") == .orderedSame,
     numberAttribute(element, kAXMenuItemCmdModifiersAttribute) == 0 {
    return boolAttribute(element, kAXEnabledAttribute) ?? true
  }

  var childrenRef: AnyObject?
  let error = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef)
  if error != .success && error != .noValue && error != .attributeUnsupported {
    scan.incomplete = true
    return nil
  }
  guard let children = childrenRef as? [AXUIElement] else { return nil }
  for child in children {
    if let state = findPasteMenuItem(child, depth: depth + 1, scan: &scan) { return state }
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
  /// `tier == none` 时的拒绝理由，其余为 nil
  let reason: FocusNoneReason?
  let role: String?
  let app: String?
  let bundleId: String?
  let pid: Int
  /// 焦点元素是否是 Blink / WebKit 的 DOM 节点；决定走哪张角色表
  let isWebContent: Bool
  /// 为等焦点元素出现实际花掉的毫秒数；大于 0 说明撞上了 Chromium 冷启动窗口
  let waitMs: Int
  /// 菜单栏标准 Cmd+V 的启用状态，仅供诊断；判定只看它存不存在
  let pasteMenuEnabled: Bool?
}

func formatJSON(_ r: FocusResult) -> String {
  let reasonStr = r.reason.map { "\"\($0.rawValue)\"" } ?? "null"
  let roleStr = r.role.map { "\"\(escapeJSON($0))\"" } ?? "null"
  let appStr = r.app.map { "\"\(escapeJSON($0))\"" } ?? "null"
  let bundleIdStr = r.bundleId.map { "\"\(escapeJSON($0))\"" } ?? "null"
  let pasteStr = r.pasteMenuEnabled.map { $0 ? "true" : "false" } ?? "null"
  return "{\"focused\":\(r.tier != .none),\"tier\":\"\(r.tier.rawValue)\",\"reason\":\(reasonStr),\"role\":\(roleStr),"
    + "\"app\":\(appStr),\"bundleId\":\(bundleIdStr),\"pid\":\(r.pid),"
    + "\"web\":\(r.isWebContent),\"waitMs\":\(r.waitMs),\"pasteMenuEnabled\":\(pasteStr)}"
}

func escapeJSON(_ s: String) -> String {
  return s
    .replacingOccurrences(of: "\\", with: "\\\\")
    .replacingOccurrences(of: "\"", with: "\\\"")
}

main()

# 全局文本焦点检测

## 原理

macOS Accessibility API（`AXUIElement`）可以获取任意应用的 UI 层级信息
`focus-check` 用它判定前台 App 此刻有没有「文本能落进去的地方」，供调用方决定直接投递还是交回上层 UI 处理

与 keyboard-listener 同架构：Swift CLI + stdout JSON 协议 + Node.js 子进程调用
区别在于 keyboard-listener 是常驻进程，focus-check 是**一次性调用**（exec → 返回 → 退出）

## 三档判定

判定结果是 `tier`，分三档，与 `insert-text` 的两条注入路径一一对应：

| tier | 判据 | 可用注入路径 |
|------|------|-------------|
| `editable` | AX 拿到了焦点元素，且它可写。Web 内容节点（`AXDOMIdentifier` 读到 success 的 Blink / WebKit 节点）看 `AXEditableAncestor`（Chromium）或选区可写 + 有效行号（WebKit）；原生控件看「选区可写」（`AXSelectedText` / `AXSelectedTextRange`）或 role 属于 `AXTextField` / `AXTextArea` / `AXComboBox` / `AXSearchField` 且整体 `AXValue` 可写 | 直插（写 AXSelectedText）与粘贴都能走 |
| `pasteable` | 焦点元素拿不到（noValue / cannotComplete，等满 600 ms 后），或只报出 `AXWindow` / `AXGroup` 这类**原生**容器、或 `aria-activedescendant` 指向的列表行（`AXStaticText`），但**有焦点窗口**（`AXFocusedWindow`）且**菜单栏挂着标准 Cmd+V**（`AXMenuItem`，cmdChar 为 `v`，cmdModifiers 为 0） | 只能走粘贴 |
| `none` | 上面两者都不满足，`reason` 说明具体是哪条：密码框（系统级安全输入，或 AX 角色 / 子角色含 secure / password）；等满预算仍拿不到焦点元素；Web 内容节点报出非可编辑角色；原生控件角色明确没有插入点；没有任何文本落点的 App（如访达）；菜单栏没有标准 Cmd+V；原生容器焦点但没有焦点窗口 | 没有落点，交回调用方 |

密码框无条件判成 `none`（`reason: 'secure-input'` / `'secure-field'`）：明文写进密码框既写坏内容，也会把文本留在不该留的地方

### 为什么 Web 内容节点要单独判定

Chromium 对所有表单控件都把 `AXSelectedText` / `AXSelectedTextRange` / `AXValue` 报成可写：`<input type=range>`（`AXSlider`）、color、checkbox、`<select>`、date 全是如此，「选区可写」在 Chromium 上没有判别力。真正准的是 `AXEditableAncestor`：文本控件（含 number、hidden textarea、contenteditable、`role=textbox`）返回自身，其余 noValue；只读输入框有 ancestor 但 `AXSelectedText` 不可写

WebKit（Safari）不提供 `AXEditableAncestor`（textarea 也 noValue），改看 `AXInsertionPointLineNumber`——有光标的元素给行号，没有的报 noValue；再要求 `AXValue` 可写挡住只读 textarea（它也有行号）

这条边界不能换成角色白名单：`<div role="combobox">` 在 Chromium 上是 `AXComboBox` 且选区、值全报可写，只有行号是 `NSIntegerMax`。曾经按角色白名单放行过一次，实测在 Chrome 里连续两次文本消失，就是一个自定义下拉组件的触发器被放了进来——insert-text 的 AX 直写因 `AXValue` 不是字符串跳过了「内容变没变」校验，直接判成功，文本实际没有落地

### 为什么 `pasteable` 还要看焦点元素的角色

实测症状：前台是访达桌面时投递，文本不知去向。判定是 `pasteable role=AXOutline` —— 访达随时有焦点窗口、菜单栏也挂着 Cmd+V，文本被 Cmd+V「粘」进桌面，Finder 对文本粘贴无动作，投递却判成功，剪贴板随后还原，整段文本丢失。这比误判成没有落点严重得多，后者调用方至少还能把文本留给用户

访达桌面 / 图标视图 / 分栏视图报 `AXList`，列表 / 画廊视图报 `AXOutline`，系统设置侧栏同样是 `AXOutline`。同一批症状还有第二种：Chrome 页面 body、VS Code 资源管理器以外的非输入区域按下投递，也是文本消失——Chromium 把它们报成 `AXWebArea` / `AXGroup`，当时被当成「可能藏着光标的容器」放进了粘贴档

实测 Chromium 热状态下从不把光标藏进容器：有光标必报可编辑角色。所以现在 Web 内容节点走独立判定——非可编辑角色一律 `none`（`reason: 'web-not-editable'`），唯一例外是 `AXStaticText`（`aria-activedescendant` 场景，真焦点仍在输入框里）；原生控件沿用角色表：AX **明确**报出焦点落在列表、表格、按钮这类不可能有插入点的控件上时，判 `none`（`reason: 'no-caret-role'`）；只有原生容器（`AXWindow` / `AXGroup`，自绘控件当第一响应者时就长这样）才留给粘贴路径

角色表只列**确定**没有插入点的角色（`canNativeElementHideCaret`）：列错一个就会把某类 App 的粘贴投递变回没有落点。访达整体不进粘贴档（`isPasteTargetExcluded`，`reason: 'excluded-app'`）：它唯一的文本落点（重命名、搜索框）都会被 `editable` 档直接命中，而侧栏 / 预览等区域实测还会报出 `AXGroup`，单靠角色表挡不住

### 为什么不再用 AXRole 白名单一档定生死

旧判定是「焦点元素的 AXRole 必须是 `AXTextField` / `AXTextArea` / `AXComboBox`」，一档定生死

实测症状：光标停在 VS Code 集成终端里时，文本**有时**投不进终端而被判成没有落点
根因是 `kAXFocusedUIElementAttribute` 在 Chromium / Electron 系应用上不稳定 —— 同一个 VS Code 进程（pid 全程一致、无目标漂移）连续两轮，一轮返回 `AXTextField` 投递成功，一轮返回 `kAXErrorNoValue` 被判成「没有输入框」。原生控件（kitty 实测）则稳定可查

而粘贴路径真正依赖的能力是「这个 App 吃不吃 Cmd+V」，恰好就是菜单栏那一项：它与焦点窗口一样稳定、非前台也查得到。判别力也正好对得上 —— VS Code / kitty 菜单栏有 Cmd+V（确实能粘），Moonlight 这类串流客户端没有（确实不该粘）

所以 AX 是外部投递唯一的闸门，只用来决定走直插还是粘贴，判定必须偏保守：宁可判成没有落点，不盲粘

### 为什么剪贴板读回执不能当投递闸门

`insert-text` 的粘贴路径带「读回执」：文本用 `declareTypes:owner:` 作为惰性承诺放上剪贴板，目标 App 处理 Cmd+V 真正读取时 pasteboard 服务会回调本进程，因此能知道「有没有人读」。曾试着把这个回执当成投递闸门、把 AX 角色判定整个拆掉，实测证明不可行：

| 目标 | 焦点状态 | 读剪贴板耗时 | 文本是否落地 |
|------|---------|------------|------------|
| Chrome | 焦点在 `body`（页面无 paste 监听） | 32 ms | 否 |
| Safari | 空白页 | 0 ms | 否 |
| 系统设置 | 侧栏（`AXOutline`） | 138 ms | 否 |

菜单项校验、SwiftUI 粘贴命令、Chromium 构建 paste 事件都会读剪贴板，「有人读」证明不了任何事；这版实测连续三次文本无声消失。回执只有反向推理成立：预算内**没有任何进程读**剪贴板，才能确定「一定没粘」（`paste-not-consumed`）

所以现在的分工是：AX 判定（`focus-check`）决定投不投，回执只是投递之后的第二道保险——确认没送达时把文本交回调用方，而不是盲目相信 Cmd+V 生效了。其余已实测的机制事实：

- 只查 `types` / `canReadObject` 不会触发回执，必须是真正的 `stringForType:` 读取
- 纯 CLI 进程只需泵 RunLoop 即可收到跨进程回执，不需要 `NSApplication`
- 兑现承诺（`provideDataForType:` 写入）不会改变 `changeCount`，写回快照前的守卫仍然可靠

### Cmd+V 探测的触发条件与开销

菜单栏探测**只在前两档都没命中时才跑**：焦点元素不存在、或存在但不可写，才去递归菜单栏找标准粘贴项
`editable` 命中时直接返回，完全不碰菜单栏

递归有两道护栏，防止病态菜单树把进程拖住：最大深度 6 层、节点预算 400 个，用尽即返回 `unknown`（与「确定没有」区分，见下）

菜单扫描区分「确定没有」（`absent`，整棵树扫完了、真没有）与「没扫完」（`unknown`，AX 超时或预算耗尽），两者都不进粘贴档，但分开记录方便诊断——`unknown` 更可能是环境问题而不是这个 App 真没有粘贴命令

`pasteMenuEnabled` 只是诊断信息，不参与判定：

- `null`：这个 App 没有标准粘贴命令，或菜单读不到 / 没扫完 → 不该被当成粘贴落点（判定依据就是这个「存不存在」）
- `false`：此刻报告为禁用，**不作为拒绝依据** —— 不少私有编辑器照常接受 Cmd+V 却长期把菜单项报成禁用

### 冷启动窗口与预热

Chromium 首次被打开完整 AX 树（或自动休眠后再被唤醒）后约 2 s 内焦点查询一律 noValue，期间偶见 cannotComplete（主线程忙）；fresh VS Code 实测 2140 ms 后才能查到，树热了以后 37 ms 就能拿到。带扩展、正在启动的真实 VS Code 甚至预热后 3.3 s 仍 noValue

为此 helper 在焦点元素拿不到时会在 600 ms 预算内轮询（`focusedElementWaitBudget`），等不到才判 `none`（`reason: 'focus-unavailable'`）；调用方还会在触发的那一刻（比如按下快捷键）先跑一次 `prewarmExternalFocusCheck()` 把前台 App 的 AX 树提前捂热，把这个窗口挤进准备时间里，真正投递时树多半已经热了

`focusWaitMs` 字段记录这一轮实际等待的毫秒数：大于 0 就说明撞上了冷启动窗口，排「光标明明在输入框里却被判成没有落点」时先看它

### AX 消息超时

单次 AX 请求上限 **0.05 秒**，进程启动时一次性设到 system-wide 对象上（`AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), …)`）

这个超时必须设在 system-wide 对象上，不能逐元素设：它只对被设置的那个对象生效、不会传给子元素，而菜单栏递归里的节点是从 `AXChildren` 数组直接取出来的，逐元素设就必然漏掉它们

原因：目标 App 主线程忙时（终端刷屏最常见）AX 默认要等 6 秒，足以拖过调用方的 execFile 超时，整次检测直接作废。宁可快速失败退到下一档

## 首次配置（开发者）

编译 Swift 二进制：

```bash
pnpm build:native
```

源码路径：`native/mac/accessibility/Sources/FocusCheck/main.swift`
二进制路径：`resources/native/mac/focus-check`（已 gitignore，不提交）

## 权限

需要 **辅助功能（Accessibility）** 权限
首次运行时 macOS 会弹出授权窗口，授权一次即可

> keyboard-listener 与 focus-check 都只需要「辅助功能」权限，但 TCC 按代码身份逐个记账：主 app 已授权不代表 helper 子进程已授权

## 架构

```
Node.js 主进程
  → execFile('focus-check')          async，超时 1500ms
    → Swift 二进制
      → AXUIElementSetMessagingTimeout    → system-wide，0.05s，避免被忙碌 App 拖死
      → NSWorkspace.frontmostApplication  → 前台应用 + PID
      → AXUIElementCreateApplication(pid)
      → AXEnhancedUserInterface = true    → 对 Chromium 系开启 AX 树（先读后写，已开则跳过）
      → AXManualAccessibility = true      → 对 Electron 官方版本开启 AX 树
      → IsSecureEventInputEnabled         → 系统级密码框检测，命中直接 none
      → AXFocusedUIElementAttribute       → 焦点元素，拿不到时轮询等满 600ms
      → 是否 Web 内容节点（AXDOMIdentifier）→ 走对应的可写判定
      → 非文本角色 / 访达                 → none（reason 说明原因）
      → AXFocusedWindow + 菜单栏 Cmd+V    → pasteable？
    → stdout JSON
  → parse → FocusCheckResult
```

## Swift 二进制协议

stdout 输出单行 JSON：

```json
{"focused":true,"tier":"editable","reason":null,"role":"AXTextField","app":"Notes","bundleId":"com.apple.Notes","pid":123,"web":false,"waitMs":0,"pasteMenuEnabled":null}
{"focused":true,"tier":"pasteable","reason":null,"role":"AXWindow","app":"Code","bundleId":"com.microsoft.VSCode","pid":456,"web":false,"waitMs":640,"pasteMenuEnabled":true}
{"focused":false,"tier":"none","reason":"no-caret-role","role":"AXButton","app":"Finder","bundleId":"com.apple.finder","pid":789,"web":false,"waitMs":0,"pasteMenuEnabled":null}
{"focused":false,"tier":"none","reason":"no-frontmost-app","role":null,"app":null,"bundleId":null,"pid":-1,"web":false,"waitMs":0,"pasteMenuEnabled":null}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `focused` | `boolean` | 是否有落点，恒等于 `tier != "none"`；只关心「投不投」的调用方看这个 |
| `tier` | `"editable" \| "pasteable" \| "none"` | 落点档位，决定走哪条注入路径 |
| `reason` | `string \| null` | `tier === "none"` 时的拒绝理由，见下表；其余为 `null` |
| `role` | `string \| null` | 焦点元素 AX 角色（如 `AXTextField`） |
| `app` | `string \| null` | 前台应用名称（localizedName，受系统语言影响） |
| `bundleId` | `string \| null` | 前台应用 Bundle ID |
| `pid` | `number` | 前台应用 PID，与 `process.pid` 对比可判断是否为自身 |
| `web` | `boolean` | 焦点元素是否是 Blink / WebKit 的 DOM 节点，决定走了哪套可写判定；仅供诊断 |
| `waitMs` | `number` | 为等焦点元素出现实际花掉的毫秒数；大于 0 说明撞上了冷启动窗口 |
| `pasteMenuEnabled` | `boolean \| null` | 菜单栏标准 Cmd+V 的启用状态，仅供诊断 |

`reason` 的取值：

| reason | 含义 |
|--------|------|
| `secure-input` | 系统级安全输入开着（`IsSecureEventInputEnabled`） |
| `secure-field` | AX 角色 / 子角色含 secure / password |
| `focus-unavailable` | 等满 600 ms 仍拿不到焦点元素（冷启动窗口，或 App 关掉了无障碍） |
| `web-not-editable` | Web 内容节点报出非可编辑角色 |
| `no-caret-role` | 原生控件角色明确没有插入点 |
| `excluded-app` | 没有任何文本落点的 App（如访达） |
| `no-paste-menu` | 菜单栏读不到、没扫完或确定没有标准 Cmd+V |
| `no-focused-window` | 原生容器焦点但 App 没有焦点窗口 |
| `no-frontmost-app` | 查不到前台 App |
| `helper-unavailable` | 辅助程序缺失 / 超时 / 输出不可解析 |

### 调试入口

```bash
resources/native/mac/focus-check --pid=<pid>
```

改查指定进程而不是前台 App，用于离线摸各 App 的兼容矩阵。判定逻辑同一套，但 `kAXFocusedUIElementAttribute` 对非前台进程本就多半查不到，`editable` 档不具参考性

## Electron / Chromium 应用兼容性

Chromium 默认不向外部进程暴露 AX 树，需要主动开启。focus-check 在查询前会设置两个属性：

| 属性 | 适用范围 | 说明 |
|------|---------|------|
| `AXEnhancedUserInterface` | 所有 Chromium 系（Chrome、VSCode 等） | Chromium 原生属性，VoiceOver 也使用此属性 |
| `AXManualAccessibility` | 标准 Electron（Electron 24+） | Electron 官方文档记载，旧版 Electron 存在 bug 不生效 |

**副作用**：两个属性均为持久状态，设为 `true` 后直到目标 app 退出前一直生效
Chromium 会在后台构建完整 AX 树（**首次设置时一次性开销**，即冷启动窗口，见上文「冷启动窗口与预热」）

`AXEnhancedUserInterface` 对 Chromium 是「重建整棵 AX 树」的开关，每次调用都无条件写会让紧接着的焦点查询更慢、更容易落空，所以实现是**先读后写**：已经开着就不再写

### 各类 App 实测覆盖情况

| App 类型 | 示例 | 判定档位 |
|---------|------|---------|
| 原生 macOS app | TextEdit、系统设置、Spotlight | `editable` |
| Chrome / Safari | 地址栏、网页 input | `editable` |
| 标准 Electron（24+） | VSCode 编辑区 | `editable` |
| Chromium 系终端 / 复杂控件 | VSCode 集成终端 | `editable`（热态）；冷启动窗口内 `none` |
| 原生终端 | kitty | `editable` / `pasteable` |
| 串流 / 游戏客户端 | Moonlight | `none`（菜单栏没有标准 Cmd+V） |
| 文件管理 / 列表焦点 | 访达桌面与各视图、系统设置侧栏 | `none`（焦点在 `AXList` / `AXOutline` 上，没有插入点） |
| 非输入区域的 Web 内容 | Chrome 页面 `body`、VS Code 资源管理器 | `none`（`AXWebArea` / `AXGroup`，Web 内容节点非可编辑角色） |
| 表单控件 | 滑块、复选框、下拉框、只读输入框 | `none`（Chromium 报选区可写但没有 `AXEditableAncestor`） |

## 使用

### 主进程

```ts
import { checkFocusedTextInput } from '@main/focus-check'

const result = await checkFocusedTextInput()

if (result.focused) {
  /** 有落点 → 注入文字到光标位置 */
  insertText(text)
}
else {
  /** 无落点 → 交回上层 UI 展示，result.reason 说明具体原因 */
  showResultWindow(text)
}
```

### API

```ts
type FocusCheckResult = {
  focused: boolean // 是否有落点
  tier: 'editable' | 'pasteable' | 'none' // 落点档位
  reason: FocusNoneReason | null // tier === 'none' 时的拒绝理由
  role: string | null // AX 角色
  app: string | null // 前台应用名称
  bundleId: string | null // 前台应用 Bundle ID
  pid: number // 前台应用 PID
  webContent: boolean // 焦点元素是否是 Web 内容节点
  focusWaitMs: number // 为等焦点元素花掉的毫秒数
  pasteMenuEnabled: boolean | null // 菜单栏标准 Cmd+V 的启用状态
}

function checkFocusedTextInput(): Promise<FocusCheckResult>

/** 在触发动作的那一刻预热前台 App 的 AX 树，不参与决策，只为耗掉冷启动窗口 */
function prewarmExternalFocusCheck(): Promise<FocusCheckResult>
```

- 超时 1500ms，超时或出错返回不可用结果（`tier: 'none'`，`reason: 'helper-unavailable'`）
- **非 macOS 平台调用 `checkFocusedTextInput` 会抛出错误**，调用方需确保仅在 macOS 上调用；`prewarmExternalFocusCheck` 在非 macOS 上直接返回不可用结果，不抛错

### role / app 为 null 的含义

| 情况 | 含义 | 建议处理 |
|------|------|---------|
| `app` 有值，`role` 为 null | AX 看不见焦点元素；仍可能因窗口 + Cmd+V 判成 `pasteable` | 看 `focused` / `tier`，不要只看 `role` |
| `app` 和 `role` 均为 null | 权限未授权或查询异常 | 展示结果 UI |

## 典型场景：外部文本投递

一次投递从触发到落地的决策分支：

```
触发（如按下快捷键） → prewarmExternalFocusCheck()   不等结果，仅捂热 AX 树
  → 输入准备阶段
    → checkFocusedTextInput()                        await
      ├─ tier: editable  → injectTextToExternalInput(text)
      │    ├─ delivered: true  → 隐藏窗口
      │    └─ delivered: false → 结果 UI（粘贴发出但没人读剪贴板，不盲发第二次）
      ├─ tier: pasteable → insertTextAtFocusedInput(text, { method: 'paste' })
      │    ├─ ok: true   → 隐藏窗口
      │    └─ ok: false  → 结果 UI
      └─ tier: none      → 结果 UI（reason 说明原因）→ 用户自行处理
```

## 核心文件

| 文件 | 职责 |
|------|------|
| `native/mac/accessibility/Sources/FocusCheck/main.swift` | Accessibility API 三档判定，输出 JSON |
| `native/mac/accessibility/Sources/InsertText/main.swift` | 直插 / 粘贴注入，粘贴路径带剪贴板读回执 |
| `resources/native/mac/focus-check` | 编译后的 macOS helper 二进制 |
| `scripts/build-native.sh` | 原生编译平台分发入口 |
| `scripts/native/build-mac.sh` | 编译为 arm64+x86_64 通用二进制 |
| `main/focus-check.ts` | Node.js 封装，execFile 调用 + JSON 解析 + 预热入口 |
| `main/insert-text.ts` | insert-text 的 Node.js 封装 |
| `main/external-text-inject.ts` | 直插失败时回退剪贴板粘贴的投递策略 |
| `electron-builder.yml` | 打包配置，extraResources 包含二进制 |

## 与 keyboard-listener 的对比

| | keyboard-listener | focus-check |
|---|---|---|
| 运行模式 | 常驻子进程 | 一次性调用 |
| 协议 | 逐行 NDJSON（v2） | 单行 JSON |
| macOS API | CGEventTap | AXUIElement (Accessibility) |
| 权限 | 辅助功能 | 辅助功能 |
| 耗时 | 持续运行 | `editable` 命中时通常 < 10ms；退到菜单栏探测会更久，单次 AX 请求上限 0.05s；冷启动窗口内轮询最多 600ms |

## 兼容性

| 平台 | 状态 |
|------|------|
| macOS Apple Silicon | ✅ |
| macOS Intel | ✅（universal binary） |
| Windows / Linux | ❌ 不支持，调用会抛出错误 |

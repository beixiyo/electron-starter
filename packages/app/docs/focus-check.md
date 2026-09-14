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
| `editable` | AX 拿到了焦点元素，且它「选区可写」（`AXSelectedText` 或 `AXSelectedTextRange` 可写）；或者 role 属于 `AXTextField` / `AXTextArea` / `AXComboBox` / `AXSearchField` 且整体 `AXValue` 可写 | 直插（写 AXSelectedText）与粘贴都能走 |
| `pasteable` | AX 看不见可写焦点元素（拿不到，或只报出 `AXWindow` / `AXGroup` / `AXWebArea` 这类藏得住光标的容器），但**有焦点窗口**（`AXFocusedWindow`）且**菜单栏挂着标准 Cmd+V**（`AXMenuItem`，cmdChar 为 `v`，cmdModifiers 为 0） | 只能走粘贴 |
| `none` | 上面两者都不满足；焦点元素是密码框；AX 明确报出焦点在列表 / 表格 / 按钮等不可能有插入点的控件上；或前台是访达 | 没有落点，交回调用方 |

密码框（role / subrole 含 `secure` 或 `password`）无条件判成 `none`：明文写进密码框既写坏内容，也会把文本留在不该留的地方

### 为什么 `pasteable` 还要看焦点元素的角色

实测症状：前台是访达桌面时投递，文本不知去向。判定是 `pasteable role=AXOutline` —— 访达随时有焦点窗口、菜单栏也挂着 Cmd+V，文本被 Cmd+V「粘」进桌面，Finder 对文本粘贴无动作，投递却判成功，剪贴板随后还原，整段文本丢失。这比误判成没有落点严重得多，后者调用方至少还能把文本留给用户

访达桌面 / 图标视图 / 分栏视图报 `AXList`，列表 / 画廊视图报 `AXOutline`，系统设置侧栏同样是 `AXOutline`。AX 既然**明确**点了名、而那个角色不可能有插入点，就照它说的办判 `none`；只有焦点元素拿不到，或落在 Chromium 会把光标藏在里面的容器时，才留给粘贴路径 —— VS Code 那条修复只依赖后者

角色表只列**确定**没有插入点的角色（`canHideCaretFromAccessibility`）：列错一个就会把某类 App 的粘贴投递变回没有落点，所以 `AXStaticText` 这种在 Chromium 里可能顶替可编辑节点出现的角色不进表。访达整体不进粘贴档（`isPasteTargetExcluded`）：它唯一的文本落点（重命名、搜索框）都会被 `editable` 档直接命中，而侧栏 / 预览等区域实测还会报出 `AXGroup`，单靠角色表挡不住

### 为什么不再用 AXRole 白名单一档定生死

旧判定是「焦点元素的 AXRole 必须是 `AXTextField` / `AXTextArea` / `AXComboBox`」，一档定生死

实测症状：光标停在 VS Code 集成终端里时，文本**有时**投不进终端而被判成没有落点
根因是 `kAXFocusedUIElementAttribute` 在 Chromium / Electron 系应用上不稳定 —— 同一个 VS Code 进程（pid 全程一致、无目标漂移）连续两轮，一轮返回 `AXTextField` 投递成功，一轮返回 `kAXErrorNoValue` 被判成「没有输入框」。原生控件（kitty 实测）则稳定可查

而粘贴路径真正依赖的能力是「这个 App 吃不吃 Cmd+V」，恰好就是菜单栏那一项：它与焦点窗口一样稳定、非前台也查得到。判别力也正好对得上 —— VS Code / kitty 菜单栏有 Cmd+V（确实能粘），Moonlight 这类串流客户端没有（确实不该粘）

所以 AX 不再当投递闸门，只用来决定走直插还是粘贴

### Cmd+V 探测的触发条件与开销

菜单栏探测**只在前两档都没命中时才跑**：焦点元素不存在、或存在但不可写，才去递归菜单栏找标准粘贴项
`editable` 命中时直接返回，完全不碰菜单栏

递归有两道护栏，防止病态菜单树把进程拖住：最大深度 6 层、节点预算 400 个，用尽即返回 `nil`

`pasteMenuEnabled` 只是诊断信息，不参与判定：

- `null`：这个 App 根本没有标准粘贴命令 → 不该被当成粘贴落点（判定依据就是这个「存不存在」）
- `false`：此刻报告为禁用，**不作为拒绝依据** —— 不少私有编辑器照常接受 Cmd+V 却长期把菜单项报成禁用

### AX 消息超时

单次 AX 请求上限 **0.05 秒**，进程启动时一次性设到 system-wide 对象上（`AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), …)`）

这个超时必须设在 system-wide 对象上，不能逐元素设：它只对被设置的那个对象生效、不会传给子元素，而菜单栏递归里的节点是从 `AXChildren` 数组直接取出来的，逐元素设就必然漏掉它们

原因：目标 App 主线程忙时（终端刷屏最常见）AX 默认要等 6 秒，足以拖过调用方 500ms 的 execFile 超时，整次检测直接作废。宁可快速失败退到下一档

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
  → execFile('focus-check')          async，超时 500ms
    → Swift 二进制
      → AXUIElementSetMessagingTimeout    → system-wide，0.05s，避免被忙碌 App 拖死
      → NSWorkspace.frontmostApplication  → 前台应用 + PID
      → AXUIElementCreateApplication(pid)
      → AXEnhancedUserInterface = true    → 对 Chromium 系开启 AX 树（先读后写，已开则跳过）
      → AXManualAccessibility = true      → 对 Electron 官方版本开启 AX 树
      → AXFocusedUIElementAttribute       → 焦点元素
      → 选区 / AXValue 可写性 + role      → editable？
      → 非文本角色 / 访达                 → none（不再赌粘贴）
      → AXFocusedWindow + 菜单栏 Cmd+V    → pasteable？
    → stdout JSON
  → parse → FocusCheckResult
```

## Swift 二进制协议

stdout 输出单行 JSON：

```json
{"focused":true,"tier":"editable","role":"AXTextField","app":"Notes","bundleId":"com.apple.Notes","pid":123,"pasteMenuEnabled":null}
{"focused":true,"tier":"pasteable","role":"AXWindow","app":"Code","bundleId":"com.microsoft.VSCode","pid":456,"pasteMenuEnabled":true}
{"focused":false,"tier":"none","role":"AXButton","app":"Finder","bundleId":"com.apple.finder","pid":789,"pasteMenuEnabled":null}
{"focused":false,"tier":"none","role":null,"app":null,"bundleId":null,"pid":-1,"pasteMenuEnabled":null}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `focused` | `boolean` | 是否有落点，恒等于 `tier != "none"`；只关心「投不投」的调用方看这个 |
| `tier` | `"editable" \| "pasteable" \| "none"` | 落点档位，决定走哪条注入路径 |
| `role` | `string \| null` | 焦点元素 AX 角色（如 `AXTextField`） |
| `app` | `string \| null` | 前台应用名称（localizedName，受系统语言影响） |
| `bundleId` | `string \| null` | 前台应用 Bundle ID |
| `pid` | `number` | 前台应用 PID，与 `process.pid` 对比可判断是否为自身 |
| `pasteMenuEnabled` | `boolean \| null` | 菜单栏标准 Cmd+V 的启用状态，仅供诊断 |

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
Chromium 会在后台构建完整 AX 树（**首次设置时一次性开销**）

`AXEnhancedUserInterface` 对 Chromium 是「重建整棵 AX 树」的开关，每次调用都无条件写会让紧接着的焦点查询更慢、更容易落空，所以实现是**先读后写**：已经开着就不再写

### 各类 App 实测覆盖情况

| App 类型 | 示例 | 判定档位 |
|---------|------|---------|
| 原生 macOS app | TextEdit、系统设置、Spotlight | `editable` |
| Chrome / Safari | 地址栏、网页 input | `editable` |
| 标准 Electron（24+） | VSCode 编辑区 | `editable` |
| Chromium 系终端 / 复杂控件 | VSCode 集成终端 | `editable` 或 `pasteable`（AX 不稳定时退到后者） |
| 原生终端 | kitty | `editable` / `pasteable` |
| 串流 / 游戏客户端 | Moonlight | `none`（菜单栏没有标准 Cmd+V） |
| 文件管理 / 列表焦点 | 访达桌面与各视图、系统设置侧栏 | `none`（焦点在 `AXList` / `AXOutline` 上，没有插入点） |

## 使用

### 主进程

```ts
import { checkFocusedTextInput } from '@main/focus-check'

const result = await checkFocusedTextInput()

if (result.focused) {
  /** 有落点 → 注入文字到光标位置 */
  insertText(transcription)
}
else {
  /** 无落点 → 交回上层 UI 展示 */
  showResultWindow(transcription)
}
```

### API

```ts
type FocusCheckResult = {
  focused: boolean // 是否有落点
  role: string | null // AX 角色
  app: string | null // 前台应用名称
  bundleId: string | null // 前台应用 Bundle ID
  pid: number // 前台应用 PID
}

function checkFocusedTextInput(): Promise<FocusCheckResult>
```

- 超时 500ms，超时或出错返回 `{ focused: false, role: null, app: null, bundleId: null, pid: -1 }`
- **非 macOS 平台调用会抛出错误**，调用方需确保仅在 macOS 上调用

> Swift 侧已经输出 `tier` 与 `pasteMenuEnabled`，`main/focus-check.ts` 目前只取 `focused` 等旧字段；需要区分直插与粘贴时再把这两个字段透出

### role / app 为 null 的含义

| 情况 | 含义 | 建议处理 |
|------|------|---------|
| `app` 有值，`role` 为 null | AX 看不见焦点元素；仍可能因窗口 + Cmd+V 判成 `pasteable` | 看 `focused` / `tier`，不要只看 `role` |
| `app` 和 `role` 均为 null | 权限未授权或查询异常 | 展示结果 UI |

## 典型场景：Voice IME

Voice IME 松开 Fn 键后的决策分支：

```
Hold Fn → 录音 → 松开 Fn → ASR 转写
  → checkFocusedTextInput()          await
    ├─ focused: true  → insertText(text)      → 隐藏窗口
    └─ focused: false → 结果 UI               → 用户自行处理
```

## 核心文件

| 文件 | 职责 |
|------|------|
| `native/mac/accessibility/Sources/FocusCheck/main.swift` | Accessibility API 三档判定，输出 JSON |
| `resources/native/mac/focus-check` | 编译后的 macOS helper 二进制 |
| `scripts/build-native.sh` | 原生编译平台分发入口 |
| `scripts/native/build-mac.sh` | 编译为 arm64+x86_64 通用二进制 |
| `main/focus-check.ts` | Node.js 封装，execFile 调用 + JSON 解析 |
| `electron-builder.yml` | 打包配置，extraResources 包含二进制 |

## 与 keyboard-listener 的对比

| | keyboard-listener | focus-check |
|---|---|---|
| 运行模式 | 常驻子进程 | 一次性调用 |
| 协议 | 逐行 NDJSON（v2） | 单行 JSON |
| macOS API | CGEventTap | AXUIElement (Accessibility) |
| 权限 | 辅助功能 | 辅助功能 |
| 耗时 | 持续运行 | `editable` 命中时通常 < 10ms；退到菜单栏探测会更久，单次 AX 请求上限 0.05s |

## 兼容性

| 平台 | 状态 |
|------|------|
| macOS Apple Silicon | ✅ |
| macOS Intel | ✅（universal binary） |
| Windows / Linux | ❌ 不支持，调用会抛出错误 |

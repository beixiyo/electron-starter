# 全局文本焦点检测

## 原理

macOS Accessibility API（`AXUIElement`）可以获取任意应用的 UI 层级信息
通过 `NSWorkspace.frontmostApplication` → `AXFocusedUIElementAttribute` → `AXRoleAttribute` 三步查询，
判断当前前台应用是否有聚焦的文本输入元素

与 fn-listener 同架构：Swift CLI + stdout JSON 协议 + Node.js 子进程调用
区别在于 fn-listener 是常驻进程，focus-check 是**一次性调用**（exec → 返回 → 退出）

## 首次配置（开发者）

编译 Swift 二进制：

```bash
pnpm build:native
```

源码路径：`native/mac/focus-check.swift`
二进制路径：`resources/native/mac/focus-check`（已 gitignore，不提交）

## 权限

需要 **辅助功能（Accessibility）** 权限
首次运行时 macOS 会弹出授权窗口，授权一次即可

> fn-listener 需要的是「输入监控」权限，focus-check 需要的是「辅助功能」权限，两者独立

## 架构

```
Node.js 主进程
  → execFile('focus-check')          async, < 10ms
    → Swift 二进制
      → NSWorkspace.frontmostApplication  → 前台应用 + PID
      → AXUIElementCreateApplication(pid)
      → AXEnhancedUserInterface = true    → 对 Chromium 系开启 AX 树（幂等）
      → AXManualAccessibility = true      → 对 Electron 官方版本开启 AX 树（幂等）
      → AXFocusedUIElementAttribute       → 焦点元素
      → AXRoleAttribute                   → 元素角色
    → stdout JSON
  → parse → FocusCheckResult
```

## Swift 二进制协议

stdout 输出单行 JSON：

```json
{"focused": true, "role": "AXTextField", "app": "Code"}
{"focused": false, "role": "AXButton", "app": "Finder"}
{"focused": false, "role": null, "app": "飞书"}
{"focused": false, "role": null, "app": null}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `focused` | `boolean` | 焦点元素是否为文本输入 |
| `role` | `string \| null` | AX 角色（如 `AXTextField`） |
| `app` | `string \| null` | 前台应用名称 |

### 判定为文本输入的角色

| 角色 | 场景 |
|------|------|
| `AXTextField` | 单行输入框（搜索栏、地址栏等） |
| `AXTextArea` | 多行文本区域（编辑器、备忘录等） |
| `AXComboBox` | 下拉选择 + 输入框 |

扩展：在 `native/mac/focus-check.swift` 的 `textRoles` 集合中添加新角色即可

## Electron / Chromium 应用兼容性

Chromium 默认不向外部进程暴露 AX 树，需要主动开启。focus-check 在查询前会设置两个属性：

| 属性 | 适用范围 | 说明 |
|------|---------|------|
| `AXEnhancedUserInterface` | 所有 Chromium 系（Chrome、飞书、VSCode 等） | Chromium 原生属性，VoiceOver 也使用此属性 |
| `AXManualAccessibility` | 标准 Electron（Electron 24+） | Electron 官方文档记载，旧版 Electron 存在 bug 不生效 |

**副作用**：两个属性均为持久状态，设为 `true` 后直到目标 app 退出前一直生效
Chromium 会在后台构建完整 AX 树（**首次设置时一次性开销**），后续调用为 no-op

### 各类 App 实测覆盖情况

| App 类型 | 示例 | 是否支持 |
|---------|------|---------|
| 原生 macOS app | TextEdit、系统设置、Spotlight | ✅ |
| Chrome / Safari | 地址栏、网页 input | ✅ |
| 标准 Electron（24+） | VSCode | ✅ |
| 自定义 Chromium | 飞书（Chromium 131） | ✅ |
| Flutter / Tauri app | — | ✅ |

## 使用

### 主进程

```ts
import { checkFocusedTextInput } from '@main/focus-check'

const result = await checkFocusedTextInput()

if (result.focused) {
  /** 有文本焦点 → 直接注入文字到光标位置 */
  pasteText(transcription)
}
else {
  /** 无文本焦点 → 展示 Transcription Result UI */
  showResultWindow(transcription)
}
```

### API

```ts
type FocusCheckResult = {
  focused: boolean // 是否有文本输入焦点
  role: string | null // AX 角色
  app: string | null // 前台应用名称
}

function checkFocusedTextInput(): Promise<FocusCheckResult>
```

- 超时 500ms，超时或出错返回 `{ focused: false, role: null, app: null }`
- **非 macOS 平台调用会抛出错误**，调用方需确保仅在 macOS 上调用

### role / app 为 null 的含义

| 情况 | 含义 | 建议处理 |
|------|------|---------|
| `app` 有值，`role` 为 null | AX 树暴露失败（极少数 app 不支持） | 保守处理：展示结果 UI |
| `app` 和 `role` 均为 null | 权限未授权或查询异常 | 展示结果 UI |

## 典型场景：Voice IME

Voice IME 松开 Fn 键后的决策分支：

```
Hold Fn → 录音 → 松开 Fn → ASR 转写
  → checkFocusedTextInput()          await，< 10ms
    ├─ focused: true  → pasteText(text)       → 隐藏窗口
    └─ focused: false → TranscriptionResult UI → 用户选 Copy / Ask
```

## 核心文件

| 文件 | 职责 |
|------|------|
| `native/mac/focus-check.swift` | Accessibility API 查询焦点元素，输出 JSON |
| `resources/native/mac/focus-check` | 编译后的 macOS helper 二进制 |
| `scripts/build-native.sh` | 原生编译平台分发入口 |
| `scripts/native/build-mac.sh` | 编译为 arm64+x86_64 通用二进制 |
| `main/focus-check.ts` | Node.js 封装，execFile 调用 + JSON 解析 |
| `electron-builder.yml` | 打包配置，extraResources 包含二进制 |

## 与 fn-listener 的对比

| | fn-listener | focus-check |
|---|---|---|
| 运行模式 | 常驻子进程 | 一次性调用 |
| 协议 | 多行文本流 | 单行 JSON |
| macOS API | IOHIDManager (HID) | AXUIElement (Accessibility) |
| 权限 | 输入监控 | 辅助功能 |
| 耗时 | 持续运行 | < 10ms |

## 兼容性

| 平台 | 状态 |
|------|------|
| macOS Apple Silicon | ✅ |
| macOS Intel | ✅（universal binary） |
| Windows / Linux | ❌ 不支持，调用会抛出错误 |

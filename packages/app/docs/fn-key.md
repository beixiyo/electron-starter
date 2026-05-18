# fn/Globe 键监听

## 原理

macOS Apple Silicon 上的 fn/Globe 键走独立的 HID 接口（usage page `0x00FF`, usage `0x0003`），
不经过 CGEventTap 或标准键盘接口。通过 IOHIDManager 监听，以 Swift 子进程实现。

Swift 二进制同时监听键盘 HID 事件（page `0x07`），在 HID 层直接检测 Fn+Key 组合，
输出 `FN_COMBO_<key>` 事件。这避免了 IOHIDManager 与 uIOhook 的跨事件源时序问题。

## 首次配置（开发者）

编译 Swift 二进制：

```bash
pnpm build:fn-listener
```

二进制路径：`resources/fn-listener`（已 gitignore，不提交）

## 权限

macOS 会弹出「输入监控」权限请求，授权一次即可。
Karabiner-Elements 兼容：Globe 键走独立接口，不受 Karabiner 影响。

## 架构

```
Swift 子进程 (IOHIDManager)
  → stdout: "FN_DOWN" / "FN_UP" / "FN_COMBO_Space" / ...
    → core.ts
      ├─ addFnKeyListener    → 'down' / 'up'
      └─ addFnComboListener  → 'Space' / 'A' / ...
        → shortcuts.ts (registerFnShortcuts 状态机)
          → Hold / DoublePress / Combo 三种模式
            → windowManager + IPC events
        → setupFnKeyIpc() → webContents.send(FN_CHANNEL.DOWN/UP)
          → preload fnApi → window.$ipc.fn
```

## Swift 二进制协议

| stdout 输出 | 含义 |
|-------------|------|
| `FN_DOWN` | Fn 键按下 |
| `FN_UP` | Fn 键松开（经 50ms 缓冲，未被 combo 消费时才输出） |
| `FN_COMBO_<key>` | Fn+Key 组合触发（如 `FN_COMBO_Space`） |

### macOS Fn+Key 时序处理

macOS 按下 Fn+其他键时，IOHIDManager 会先发送合成 FN_UP，随后才有键盘 keydown。
Swift 二进制内部用 50ms 缓冲吞掉合成 FN_UP：

1. FN_DOWN → 立即输出
2. FN_UP → 缓冲 50ms，不立即输出
3. 50ms 内有 combo key → 输出 `FN_COMBO_<key>`，**不输出** FN_UP
4. 50ms 内无 combo key → 输出 FN_UP

### 支持的 combo 键

| 类别 | 键名 |
|------|------|
| 字母 | `A`-`Z` |
| 数字 | `0`-`9` |
| 修饰 | `Ctrl` `Shift` `Alt` `Meta` + `CtrlRight` `ShiftRight` `AltRight` `MetaRight` |
| 导航 | `Up` `Down` `Left` `Right` `Home` `End` `PageUp` `PageDown` |
| 功能 | `F1`-`F12` |
| 特殊 | `Space` `Enter` `Escape` `Tab` `Backspace` `Delete` `CapsLock` |
| 标点 | `Minus` `Equal` `Comma` `Period` `Slash` `Backslash` `Quote` `Semicolon` `Grave` `LeftBracket` `RightBracket` |

扩展：在 `fn-listener.swift` 的 `COMBO_KEYS` 字典中添加 HID usage → 键名映射即可。

## 快捷键集成

三种模式通过 `registerFnShortcuts` 统一注册，由 300ms 决策窗口状态机裁决：

```ts
registerFnShortcuts({
  hold: {
    windowType: WindowType.VOICE_IME,
    onRelease: async (result) => { /* ASR 结果处理 */ },
  },

  doublePress: {
    windowType: WindowType.SHORTCUT_TEST,
    onTrigger: () => { /* 双击业务逻辑 */ },
  },

  combos: [
    {
      key: 'Space',  // 键名需与 Swift COMBO_KEYS 一致
      onTrigger: () => { /* Fn+Space 业务逻辑 */ },
    },
  ],
})
```

### 渲染进程监听

```ts
window.$ipc.fn.onDown(() => console.log('fn pressed'))
window.$ipc.fn.onUp(() => console.log('fn released'))
```

## 核心文件

| 文件 | 职责 |
|------|------|
| `resources/fn-listener.swift` | HID 层监听 Fn + 键盘事件，输出协议事件 |
| `main/fn-listener/core.ts` | 管理 Swift 子进程，解析 stdout，分发 key/combo 监听器 |
| `main/fn-listener/shortcuts.ts` | 300ms 状态机，裁决 Hold / DoublePress / Combo |
| `main/index.ts` | 注册具体业务行为 |

## 兼容性

| 平台 | 状态 |
|------|------|
| macOS Apple Silicon | ✅ |
| macOS Intel | ✅（universal binary） |
| Windows / Linux | 自动跳过（`process.platform !== 'darwin'`） |
| Karabiner-Elements | ✅ 兼容 |

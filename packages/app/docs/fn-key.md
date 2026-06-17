# fn/Globe 键监听

## 原理

> 排查全过程、权限模型与踩坑详见 [`fn-key-investigation.md`](./fn-key-investigation.md)

以 Swift 子进程监听 Fn/Globe 键，通过 **`CGEvent.tapCreate(tap: .cghidEventTap, options: .defaultTap)`**（HID 层的主动事件 tap）读取，**只需「辅助功能」权限，不需要「输入监控」**

- Fn 键在 `flagsChanged` 事件里以 `keyCode == 63`（kVK_Function）出现，配合 `maskSecondaryFn` 标志判断按下/松开
- Fn+Key 组合：先收到 Fn 自身的 `flagsChanged` 按下边沿，再在 Fn 按住期间处理 `keyDown` → 输出 `FN_COMBO_<key>`
- 选 **HID 层**（而非 session 层 / NSEvent）的原因：HID 层在「Karabiner 虚拟键盘剥标志」和「系统按🌐键消费 Globe」之前，所以即便开着 Karabiner 也能稳读、标志也完好

## 首次配置（开发者）

编译 Swift 二进制：

```bash
pnpm build:fn-listener
```

二进制路径：`resources/fn-listener`（已 gitignore，不提交）

## 权限

只需 **「辅助功能」**（隐私与安全性 → 辅助功能），授权一次即可 —— app 本来就为 `focus-check` / 自动打字申请了它
**不需要「输入监控」**：主动 CGEventTap（`.defaultTap`）走的是 PostEvent（显示在辅助功能面板），不是输入监控
Karabiner-Elements 兼容：HID 层 tap 在 Karabiner 处理之前，不受影响

> ⚠️ **打包后双击启动「授权了也没用」是签名问题，不是这里的实现问题** —— ad-hoc 签名让 TCC 授权绑不准，需稳定签名身份。根因与修复（自签名验证 + 生产 Developer ID + 公证）见 [`mac-code-signing.md`](./mac-code-signing.md)

## 架构

```
Swift 子进程 (CGEventTap .cghidEventTap)
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
| `FN_UP` | Fn 键松开 |
| `FN_COMBO_<key>` | Fn+Key 组合触发（如 `FN_COMBO_Space`） |

### Fn 判定与防误判

- **按下/松开**：`flagsChanged` 中 `keyCode == 63`，优先用 `maskSecondaryFn` 标志判定；标志缺失（如被 Karabiner 剥掉）时退回翻转
- **组合键**：`keyDown` 不能单靠 `maskSecondaryFn` 推导 Fn 按下，因为方向键、Home/End、PageUp/PageDown 等 navigation key 自身也可能携带 function 类标志；必须先由 `keyCode == 63` 的 `flagsChanged` 确认 Fn 已按下，再输出 `FN_COMBO_<key>`。另设 0.6s 时间窗，兼容 Karabiner 下标志被剥的场景
- **防污染**：无 `maskSecondaryFn` 的普通打字会强制清零 Fn 按下态并补发 `FN_UP`，杜绝掉边沿后把正常输入误判成组合键

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

扩展：在 `fn-listener.swift` 的 `COMBO_KEYS` 字典中添加 虚拟键码 `kVK_*` → 键名映射即可（注意是 CGEvent 虚拟键码，不是 HID usage）

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

### Voice IME 与 macOS 原生全屏

长按 Fn 打开 Voice IME 时，如果主窗口已通过红绿灯进入 macOS 原生全屏，Voice IME 必须按 **full-screen auxiliary / panel** 方式创建，否则可能被系统切到新的黑屏 Space。窗口配置与修复方式见 [`custom-window.md`](./custom-window.md#macos-全屏-space-上的辅助浮窗)

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
| Windows / Linux | ❌ 不支持，调用会抛出错误 |
| Karabiner-Elements | ✅ 兼容 |

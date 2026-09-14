# macOS SwiftPM helpers

八个原生 helper 按最低系统版本拆成五个独立 SwiftPM package，构建脚本只负责选择 package、分别构建两个架构并合并产物

| package | products | minimum macOS |
| --- | --- | --- |
| `accessibility/` | `focus-check`, `keyboard-listener`, `settings-window`, `insert-text` | 11.0 |
| `hour-cycle/` | `hour-cycle` | 14.2 |
| `audio-recorder/` | `audio-recorder` | 14.0 |
| `audio-monitor/` | `audio-monitor` | 14.2 |
| `screenshot-capture/` | `screenshot-capture` | 14.0 |

直接检查 package manifest：

```sh
swift package dump-package --package-path packages/app/native/mac/accessibility
swift package dump-package --package-path packages/app/native/mac/hour-cycle
swift package dump-package --package-path packages/app/native/mac/audio-recorder
swift package dump-package --package-path packages/app/native/mac/audio-monitor
swift package dump-package --package-path packages/app/native/mac/screenshot-capture
```

`KeyboardListenerCore` 使用独立测试 package，避免生产 helper 解析远程测试依赖：

```sh
swift test --package-path packages/app/native/mac/accessibility/Tests
```

统一构建入口是 `packages/app/scripts/native/build-mac.sh`。它最终只写入以下既有 Electron 产物路径：

```text
resources/native/mac/focus-check
resources/native/mac/settings-window
resources/native/mac/insert-text
resources/native/mac/hour-cycle
resources/native/mac/keyboard-listener
resources/native/mac/audio-monitor
resources/native/mac/audio-recorder
resources/native/mac/screenshot-capture
```

SwiftPM 编译缓存保留在各 package 的 `.build/` 中，同一 package 的 products 共享缓存。首次或源码变化后会重新编译，后续构建复用增量结果；缓存属于本地产物，不进入 Git

## 键盘原始输入协议（v2）

`keyboard-listener` 上报全键盘物理事件（普通键、左右修饰键、Fn/Globe 走同一条流），逐行 NDJSON 输出，不判断 chord、press、doublePress、hold 或任何 action/scope 语义：

```json
{"fn":false,"key":"Fn","modifiers":[],"phase":"down","timestamp":123456789,"type":"input","v":2}
{"fn":true,"key":"Space","modifiers":["Meta"],"phase":"down","timestamp":123456820,"type":"input","v":2}
{"fn":true,"key":"Space","modifiers":["Meta"],"phase":"up","timestamp":123456960,"type":"input","v":2}
{"timestamp":123457000,"type":"reset","v":2}
```

- `key` 用 W3C `KeyboardEvent.code` 命名（字母数字去掉前缀），映射表见 `Sources/KeyboardListenerCore/MacKeyCodes.swift`；表外键码（国际键、Lang 键等）直接丢弃
- `modifiers` 是事件发生瞬间的逻辑修饰键快照：`Control` / `Alt` / `Shift` / `Meta`
- `fn` 标记该键属于 Fn 组合：Fn 按住期间带 `maskSecondaryFn` 的键，或 Fn 按下 600ms 内到达的键（兼容 fn flag 晚于 keyDown 的键盘）
- `timestamp` 是 helper generation 内可比较的 monotonic milliseconds
- 系统自动重复、重复 down、没有对应 down 的 up 在 Swift 侧直接丢弃
- 左右修饰键按各自键码配对 down/up，家族 flag 只用来拒绝没有对应 down 的陈旧 release
- tap disabled 时输出 reset、清空物理状态并重新启用 tap
- 除下面的 🌐 键动作外，helper 透传全部 CGEvent，不拦截用户输入
- 仅保证标准 macOS Fn/Globe 事件；不保证 Karabiner 等移除 `maskSecondaryFn` 的重映射环境
- Swift 只上报 physical down/up/reset，down/up 配对与 chord 合成统一由 TypeScript 侧完成

主进程经 stdin 下发命令，同样逐行 JSON、同一协议版本：

```json
{"v":2,"type":"config","suppressGlobeKey":true}
```

- `suppressGlobeKey` 为 true 时，helper 在 tap 层对 🌐 键动作事件（keyCode 0xB3 的 keyDown / keyUp）`return nil`。Fn 单独按下再松开时系统会合成这一对事件，前台 App 收到后才按「按下🌐键时」的设置开表情面板 / 切输入法 / 启动听写；吞掉它等价于该设置为「不执行任何操作」。Fn 自身的 flagsChanged 照常放行，fn+方向键、fn+Delete、fn+F 键不受影响（实测）
- helper 启动时恒为不抑制；主进程只在当前绑定里有裸 Fn 动作时下发 true，helper 重启后由主进程补发
- 字段集合必须精确匹配，不合法的行输出 `KEYBOARD_COMMAND_IGNORED` 到 stderr 后丢弃

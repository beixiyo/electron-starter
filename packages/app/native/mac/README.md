# macOS SwiftPM helpers

七个原生 helper 按最低系统版本拆成五个独立 SwiftPM package，构建脚本只负责选择 package、分别构建两个架构并合并产物

| package | products | minimum macOS |
| --- | --- | --- |
| `accessibility/` | `focus-check`, `fn-listener`, `settings-window` | 11.0 |
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

`FnListenerCore` 使用独立测试 package，避免生产 helper 解析远程测试依赖：

```sh
swift test --package-path packages/app/native/mac/accessibility/Tests
```

统一构建入口是 `packages/app/scripts/native/build-mac.sh`。它最终只写入以下既有 Electron 产物路径：

```text
resources/native/mac/focus-check
resources/native/mac/settings-window
resources/native/mac/hour-cycle
resources/native/mac/fn-listener
resources/native/mac/audio-monitor
resources/native/mac/audio-recorder
resources/native/mac/screenshot-capture
```

SwiftPM 编译缓存保留在各 package 的 `.build/` 中，同一 package 的 products 共享缓存。首次或源码变化后会重新编译，后续构建复用增量结果；缓存属于本地产物，不进入 Git

## Fn/Globe 原始输入协议

`fn-listener` 使用逐行 JSON 输出物理输入，不判断 press、doublePress、hold 或任何 action/scope 语义：

```json
{"v":1,"type":"input","phase":"down","sequence":104,"timestamp":123456789,"key":"Fn","modifiers":[]}
{"v":1,"type":"input","phase":"down","sequence":105,"timestamp":123456820,"key":"Space","modifiers":["Meta"]}
{"v":1,"type":"input","phase":"up","sequence":105,"timestamp":123456960,"key":"Space","modifiers":["Meta"]}
{"v":1,"type":"reset","timestamp":123457000}
```

- `timestamp` 是 helper generation 内可比较的 monotonic milliseconds
- 同一物理按压的 down/up 共享 `sequence`
- combo up 复用 down 时冻结的 key/modifiers
- Fn 提前松开时先补齐 active combo up，再输出 Fn up
- tap disabled 时输出 reset、清理物理状态并重新启用 tap
- helper 始终透传 CGEvent，不拦截用户输入
- 仅保证标准 macOS Fn/Globe 事件；不保证 Karabiner 等移除 `maskSecondaryFn` 的重映射环境
- Swift 只上报 physical down/up/reset，gesture 统一由 TypeScript shared gesture engine 判断

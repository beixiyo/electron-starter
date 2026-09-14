# Fn / Globe 快捷键

macOS 的 Fn / Globe 无法由 Electron 或 uiohook 稳定捕获，因此由独立 Swift helper（`keyboard-listener`）上报物理事件。Swift 不判断 chord、press、doublePress、hold，也不执行业务 action

> helper 与 TypeScript 两侧都在 NDJSON v2 上：helper 全键盘上报物理相位，down/up 配对与 chord 合成下沉到 `shared/shortcuts/input-tracker.ts`。协议细节以 `native/mac/README.md` 为准

## 数据流

```text
CGEventTap
  → KeyboardPhysicalState（内含 FnPhysicalInputClassifier）
  → KeyboardListenerEventEncoder
  → stdout NDJSON v2
  → main/shortcuts/input/native-mac/protocol.ts   ← 严格解码，fail closed
  → main/shortcuts/input/native-mac/backend.ts    ← 进程生命周期 + 时间基归一到 epoch
  → shared/shortcuts/input-tracker.ts             ← 合成 chord
  → shared/shortcuts/gesture-engine.ts
```

Swift 负责：

- 全键盘物理 `down/up`：普通键、左右修饰键与 Fn/Globe 走同一条流
- 去除系统 autorepeat、重复 down 与没有对应 down 的 up
- 左右修饰键按各自键码配对 down/up，家族 flag 只用来拒绝陈旧 release
- 标记每个按键是否属于 Fn 组合（带 `maskSecondaryFn`，或 Fn 按下 600ms 内到达）
- event tap 失效时输出 reset 并清空物理状态

TypeScript 负责：

- 严格校验 NDJSON 协议
- press、doublePress、hold 手势判定
- action、scope、provider 和业务执行
- helper 退出或 reset 后释放 active hold

## 协议示例

helper 当前输出 v2（无 `sequence`，新增 `fn` 组合归属标记）：

```json
{"fn":false,"key":"Fn","modifiers":[],"phase":"down","timestamp":123456789,"type":"input","v":2}
{"fn":true,"key":"Space","modifiers":["Meta"],"phase":"down","timestamp":123456820,"type":"input","v":2}
{"fn":true,"key":"Space","modifiers":["Meta"],"phase":"up","timestamp":123456960,"type":"input","v":2}
{"timestamp":123457000,"type":"reset","v":2}
```

`key` 用 W3C `KeyboardEvent.code` 命名，与 `shared/shortcuts` 的 `KEYBOARD_CODES` 同空间；`FN_COMBO_KEYS` 由 `KEYBOARD_CODES` 减去修饰键与锁定键派生，两侧共用同一个命名空间

`timestamp` 是 helper 的 **uptime 毫秒**（`ProcessInfo.systemUptime`），由 `native-mac/backend.ts` 在后端边界平移成 `Date.now()` 的 epoch 基，再交给上层 —— DOM 与 uIOhook 后端本来就报 epoch，混基会让去重窗口永不命中、轻点被判成 hold

协议 decoder fail closed：未知版本、字段集合不精确匹配、未知键名、非法 modifier、负数或非整数 timestamp 都会被整行丢弃，不进 tracker

主进程反向经 helper stdin 下发命令，同一协议版本：

```json
{"v":2,"type":"config","suppressGlobeKey":true}
```

`suppressGlobeKey` 让 helper 在 tap 层吞掉 🌐 键动作事件（Fn 单击松开后系统合成的 keyCode 0xB3 keyDown / keyUp），表情面板 / 输入法切换不再随裸 Fn 触发；只在绑定表里有裸 Fn 动作时为 true，由 `input-runtime-backend` 决定、`native-mac/backend.ts` 保留状态并在 helper 换代后补发。Swift 侧 `KeyboardListenerCommandDecoder` 同样按字段集合精确匹配

**线格式的黄金样本由两处逐字共同持有**：`Tests/.../KeyboardListenerEventEncoderTests.swift` 与 `main/shortcuts/input/native-mac/protocol.test.ts` 的 `GOLDEN_*`。改字段名必须同时改这两个文件，否则两侧会各自漂移而测试全绿

## 代码位置

| 职责 | 路径 |
|---|---|
| Swift helper 与物理状态机 | `native/mac/accessibility/` |
| helper 生命周期与 decoder | `main/shortcuts/input/native-mac/` |
| 系统级 runtime backend | `main/shortcuts/input-runtime-backend.ts` |
| Fn 组合成员键的窗口内抑制 | `main/shortcuts/fn-combo-suppression.ts` |
| chord 合成与手势状态机 | `shared/shortcuts/input-tracker.ts`、`gesture-engine.ts` |

## 构建与验证

```bash
swift test --package-path native/mac/accessibility/Tests
pnpm build:native:mac
```

`resources/native/mac/keyboard-listener` 是 gitignore 的构建产物。**没有它 Fn 与全局快捷键整条链路静默不可用**：后端的 `isAvailable()` 会直接判不可用（并打一条 `keyboard-listener.binary-missing` 错误日志），全局绑定降级成只在窗口内生效。fresh clone 第一件事就是 `pnpm build:native:mac`

静态测试与 universal build 不能证明真实 macOS 行为。发布前仍需在签名应用中验证内置/外接键盘、两种松键顺序、自动重复、辅助功能权限撤销恢复和 helper crash/restart

当前明确不兼容会剥离 `maskSecondaryFn` 的 Karabiner 配置；不使用时间窗或 toggle 启发式猜测 Fn 状态

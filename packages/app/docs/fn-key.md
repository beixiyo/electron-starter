# Fn / Globe 快捷键

macOS 的 Fn / Globe 无法由 Electron 或 uiohook 稳定捕获，因此由独立 Swift helper（`keyboard-listener`）上报物理事件。Swift 不判断 chord、press、doublePress、hold，也不执行业务 action

> ⚠️ **当前状态**：helper 已换代为全键盘上报、线协议升到 v2；`main/shortcuts/fn/protocol.ts` 仍只解析 v1，down/up 配对与 chord 合成下沉到 TypeScript 的改造安排在输入层改造期。在那之前 Fn 快捷键在运行时不可用。协议细节以 `native/mac/README.md` 为准

## 数据流

```text
CGEventTap
  → KeyboardPhysicalState（内含 FnPhysicalInputClassifier）
  → KeyboardListenerEventEncoder
  → stdout NDJSON v2
  → main/shortcuts/fn/protocol.ts        ← 当前仍解析 v1，待输入层改造期切换
  → main/shortcuts/fn/runtime-backend.ts
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

`key` 用 W3C `KeyboardEvent.code` 命名，与 `shared/shortcuts` 的 `KEYBOARD_CODES` 同空间；**注意 `FN_COMBO_KEYS` 仍是 v1 键名空间**，两者尚未统一

**TS 侧当前仍解析 v1**（`protocol.ts` 的 `PROTOCOL_VERSION = 1`，并要求 `sequence` 字段），因此 v2 的每一行都会被判为非法行丢弃。切到 v2 属于输入层改造期，不要以为这条链路已经通了

协议 decoder fail closed：未知字段、未知键名、非法 modifier、重复 down/up 都不会进入 gesture engine

## 代码位置

| 职责 | 路径 |
|---|---|
| Swift helper 与物理状态机 | `native/mac/accessibility/` |
| helper 生命周期与 decoder | `main/shortcuts/fn/core.ts`、`protocol.ts` |
| Fn runtime backend | `main/shortcuts/fn/runtime-backend.ts` |
| renderer raw event IPC | `ipc/services/fn/` |
| 手势状态机 | `shared/shortcuts/gesture-engine.ts` |

## 构建与验证

```bash
swift test --package-path native/mac/accessibility/Tests
pnpm build:native:mac
```

静态测试与 universal build 不能证明真实 macOS 行为。发布前仍需在签名应用中验证内置/外接键盘、两种松键顺序、自动重复、辅助功能权限撤销恢复和 helper crash/restart

当前明确不兼容会剥离 `maskSecondaryFn` 的 Karabiner 配置；不使用时间窗或 toggle 启发式猜测 Fn 状态

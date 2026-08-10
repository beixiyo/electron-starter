# Fn / Globe 快捷键

macOS 的 Fn / Globe 无法由 Electron 或 uiohook 稳定捕获，因此由独立 Swift helper 上报物理事件。Swift 不判断 press、doublePress、hold，也不执行业务 action

## 数据流

```text
CGEventTap
  → FnPhysicalInputClassifier
  → FnPhysicalEventReducer
  → stdout NDJSON
  → main/shortcuts/fn/protocol.ts
  → main/shortcuts/fn/runtime-backend.ts
  → shared/shortcuts/gesture-engine.ts
```

Swift 负责：

- Fn 与 Fn 组合键的物理 `down/up`
- 去除 autorepeat 和重复边沿
- down 时冻结 chord，up 复用同一 sequence、key 和 modifiers
- Fn 提前松开时补齐 active combo 的 up
- event tap 失效时输出 reset 并清理物理状态

TypeScript 负责：

- 严格校验 NDJSON 协议
- press、doublePress、hold 手势判定
- action、scope、provider 和业务执行
- helper 退出或 reset 后释放 active hold

## 协议示例

```json
{"v":1,"type":"input","phase":"down","sequence":104,"timestamp":123456789,"key":"Fn","modifiers":[]}
{"v":1,"type":"input","phase":"down","sequence":105,"timestamp":123456820,"key":"Space","modifiers":[]}
{"v":1,"type":"input","phase":"up","sequence":105,"timestamp":123456960,"key":"Space","modifiers":[]}
{"v":1,"type":"reset","timestamp":123457000}
```

协议 decoder fail closed：未知字段、未知键名、非法 modifier、重复 down/up 或不一致的 frozen chord 都不会进入 gesture engine

## 代码位置

| 职责 | 路径 |
|---|---|
| Swift helper 与 reducer | `native/mac/accessibility/` |
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

# keyboard — 快捷键子系统

所有快捷键相关的检测、注册、录制逻辑集中在此目录，通过 `index.ts` 统一对外导出。

## 目录结构

```
shortcuts/
  fn/                        Fn 键监听 + 手势状态机（macOS 专属）
    core.ts                  Swift 二进制通信层，解析 FN_DOWN / FN_UP / FN_COMBO_*
    runtime-backend.ts       Fn provider：把 binding 转成 state-machine 注册配置
    state-machine.ts         300ms 决策状态机；手势互斥裁决、fn IPC 事件透传、runtime 事件回调
    types.ts                 Fn backend 内部注册配置（main-only，包含函数回调）
    index.ts

  hold/                      长按相关的全部机制
    state-manager.ts         长按状态追踪（startTime / isHolding / onRelease）
    resolve-key-group.ts     accelerator 字符串 → uiohook keycode 数组
    types.ts                 hold manager 内部状态与回调配置（main-only）
    index.ts

  global/                    全局快捷键
    hotkey.ts                keyboard provider：只注册系统级 global keyboard binding
    gesture.ts               uiohook keydown/keyup 捕获层，把事件交给 shared gesture engine
    index.ts

  record/                    录制模式专用
    detector.ts              uiohook keydown 全局捕获修饰键组合，推送给渲染进程
    index.ts

  capabilities.ts            配置能力 / 当前 runtime 能力过滤
  providers.ts               Electron provider 声明，供 runtime、capabilities 和诊断共用
  runtime.ts                 过滤 binding 并调度所有 runtime provider
  runtime-backend.ts         main-only provider 声明、注册项和统一事件派发
  runtime-sync.ts            权限或外部状态变化后的 runtime 重算通知
  uiohook-lifecycle.ts       uiohook 引用计数管理，hold 与 record 共用一个 start/stop
  scope.ts                   global / local scope 运行时门禁
  cleanup.ts                 app will-quit 退出清理，import 时自动注册
  index.ts                   统一导出
```

共享手势状态机位于 `shared/shortcuts/gesture-engine.ts`，由主进程 global keyboard backend 和 renderer local keyboard runtime 共同使用；共享录制状态机位于 `shared/shortcuts/record-engine.ts`，设置页只消费标准化后的 `ShortcutRecordEvent`。新增捕获 backend 时应优先产出 `ShortcutRecordEvent` 并复用这些状态机。

## 检测机制对照

| 手势 | 模块 | 机制 |
|---|---|---|
| fn + key (combo) | `fn/core` → `fn/state-machine` | Swift IOHIDManager → `FN_COMBO_*` stdout |
| 双击 fn | `fn/state-machine` | 状态机 300ms 决策窗口，派发 runtime trigger |
| 长按 fn | `fn/state-machine` | 300ms 超时进入 `HOLD_ACTIVE`，派发 runtime trigger / release |
| 键盘快捷键 **全局激活** | `global/hotkey` → `global/gesture` → shared gesture engine | uiohook 全局监听，只注册 `scope: 'global'` |
| 键盘快捷键 **窗口内激活** | `renderer/shortcuts/useShortcutRuntime` → shared gesture engine | DOM `keydown/keyup`，只处理 `scope: 'local'` 的 keyboard binding |
| 键盘快捷键 **录制** | `record/detector` | uiohook `keydown/up` 全局捕获修饰键组合，统一推送 `ShortcutRecordEvent` |
| fn 手势 **录制** | `fn/state-machine` → IPC → renderer adapter | Fn down/up/combo 在 renderer adapter 归一为 `ShortcutRecordEvent` |
| 长按键盘快捷键 | shared gesture engine | 标准化 down/up + timer，trigger / release 统一派发 |
| 双击键盘快捷键 | shared gesture engine | 标准化 down/up 或 press + timer |

## Provider 声明

| provider id | source | scopes | 所在层 |
|---|---|---|---|
| `fn` | `fn` | `global` / `local` | main native helper（macOS only） |
| `keyboard` | `keyboard` | `global` | main uiohook |
| `renderer-keyboard` | `keyboard` | `local` | renderer DOM |
| `dom-keyboard` | `keyboard` | `local` | Web DOM |

## 关键约束

- **能力声明按 scope/source/provider 拆分**：配置与 runtime 能力都按 `global/local × keyboard/fn` 表达，并按当前平台暴露 provider。持久化只按平台过滤；真正注册前再按当前权限、native backend 状态过滤，避免权限未授予时把用户配置写成 `null`。
- **runtime provider 入口统一**：`runtime.ts` 不直接了解 uiohook / Fn 状态机细节，只过滤 binding 并调度 `ShortcutRuntimeBackend`；provider 必须声明 `source` 和 `scopes`，并通过 `ShortcutRuntimeCapabilities.providers` 暴露给 renderer，新增 Electron `globalShortcut`、`before-input-event` 或外部 native API 时只新增 provider。
- **runtime 重算入口统一**：配置变化、权限刷新、App activate、Fn helper 异常退出都走 `runtime-sync.ts` 请求重新注册或卸载快捷键。
- **键盘手势状态机共享**：全局 uiohook 和窗口内 DOM backend 都复用 `shared/shortcuts/gesture-engine.ts`，避免 press / doublePress / hold 的判断在不同平台漂移。
- **快捷键录制状态机共享**：设置页录制复用 `shared/shortcuts/record-engine.ts`，录制层只负责把 native / uiohook / DOM 事件归一为 `ShortcutRecordEvent`。
- **`suspended` 标志**：`fn/state-machine` 内维护，录制模式下 `suspendFnShortcuts()` 屏蔽所有 fn 手势触发；`global/gesture` 同样检查 `isSuspended()`。
- **uiohook 共享生命周期**：`global/gesture` 和 `record/detector` 均通过 `uiohook-lifecycle` 的引用计数共用同一个 `uIOhook.start/stop`，不得直接调用。
- **fn combo 由 Swift 报告**：combo 由 Swift 二进制合成后输出 `FN_COMBO_*`，主进程状态机不自己合成，避免跨事件源时序问题。
- **录制事件统一**：不同 backend 可以提供 `down/up` 或完整 `press`，但设置页只消费 `ShortcutRecordEvent`，不直接感知 Fn IPC、uiohook 或 DOM KeyboardEvent。录制状态机只输出 `gesture + chord`，保存边界才附加 `global/local` scope。
- **抽象修饰键延迟归一**：配置里可以保留 `Primary`，运行时注册和冲突比较再映射为当前平台真实修饰键，避免把跨平台配置写死到某个系统。
- **Fn backend 不拥有业务 UI**：`fn/state-machine` 只裁决手势并回调 runtime 事件，不直接操作窗口、hold 状态或具体 action；Voice IME、截图、调试窗都由 main action handler 处理。
- **local keyboard 不依赖 main 进程全局监听**：Electron / Web 的 local keyboard binding 都走 renderer DOM backend；main 进程 keyboard provider 只负责系统级 global binding。
- **设置页能力来自 capabilities**：是否允许选择「全局」由 `ShortcutRuntimeCapabilities` 决定，而不是硬编码 `isElectron()`。

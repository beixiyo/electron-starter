# shortcuts — 快捷键子系统

所有快捷键相关的检测、注册、录制逻辑集中在此目录，通过 `index.ts` 统一对外导出

## 目录结构

```
shortcuts/
  fn/                        Fn 键监听 + 手势状态机（macOS 专属）
    core.ts                  Swift helper 生命周期 + NDJSON 严格解码
    ipc.ts                   把 raw down/up/reset 转发给设置页录制
    protocol.ts              Fn native 协议校验与物理序列配对
    runtime-backend.ts       Fn provider：raw 事件接入 shared gesture engine
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
  uiohook-lifecycle.ts       uiohook Worker 进程级生命周期与消费者引用计数，hold 与 record 共用
  scope.ts                   global / local scope 运行时门禁
  suspension.ts              录制期间统一暂停 main runtime
  cleanup.ts                 app will-quit 退出清理，import 时自动注册
  index.ts                   统一导出
```

共享手势状态机位于 `shared/shortcuts/gesture-engine.ts`，由主进程 global keyboard backend 和 renderer local keyboard runtime 共同使用；共享录制状态机位于 `shared/shortcuts/record-engine.ts`，设置页只消费标准化后的 `ShortcutRecordEvent`。新增捕获 backend 时应优先产出 `ShortcutRecordEvent` 并复用这些状态机

## 检测机制对照

| 手势 | 模块 | 机制 |
|---|---|---|
| fn + key (combo) | Swift reducer → `fn/core` → shared gesture engine | CGEventTap NDJSON raw down/up |
| 双击 fn | shared gesture engine | 两次完整 down/up 的决策窗口 |
| 长按 fn | shared gesture engine | down 后超时触发，up/reset 幂等释放 |
| 键盘快捷键 **全局激活** | `global/hotkey` → `global/gesture` → shared gesture engine | uiohook 全局监听，只注册 `scope: 'global'` |
| 键盘快捷键 **窗口内激活** | `renderer/shortcuts/useShortcutRuntime` → shared gesture engine | DOM `keydown/keyup`，只处理 `scope: 'local'` 的 keyboard binding |
| 键盘快捷键 **录制** | `record/detector` + renderer DOM fallback | uiohook 与 DOM 都输出 canonical `ShortcutRecordEvent`，renderer 去重；native 不可用时仍可录普通键盘 |
| fn 手势 **录制** | `fn/core` → raw IPC → renderer adapter | 透传 native phase、chord 和 monotonic timestamp |
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

- **能力声明按 scope/source/provider 拆分**：配置与 runtime 能力都按 `global/local × keyboard/fn` 表达，并按当前平台暴露 provider。持久化只按平台过滤；真正注册前再按当前权限、native backend 状态过滤，避免权限未授予时把用户配置写成 `null`
- **scope 是动作语义，不是能力检测**：`SHORTCUT_ACTIONS[].scope` 声明该动作要不要在应用不在前台时触发，录制保存时原样沿用（`toShortcutActionBinding`）。当前能不能全局捕获属于运行时判断，由 `resolveEffectiveShortcutScope` 计算：声明 `global` 但系统级捕获不可用时降级为 `local`，**降级结果只用于注册，不写回配置**，权限恢复后能自动升回 global
- **只有必须全局的才吃 native**：main 侧 keyboard backend 只认领有效 scope 为 `global` 的绑定，降级到 `local` 的 keyboard 绑定交给渲染进程 DOM backend（`renderer/shortcuts/useShortcutRuntime.ts`），触发后经 `shortcutConfig.trigger` 回传主进程执行业务。Fn 例外：DOM 拿不到 Fn/Globe，local scope 的 fn 绑定仍由 native backend 捕获，靠 `scope.ts` 的聚焦门禁约束生效范围
- **runtime provider 入口统一**：`providers.ts` 的 registry 集中声明 descriptor、平台、运行位置与 availability；`runtime.ts` 只调度对应的 `ShortcutRuntimeBackend`。新增 backend 时必须同时提供 registry 条目与 backend 实现，不能只改能力布尔值
- **runtime 重算入口统一**：配置变化、权限刷新、App activate、Fn helper/uiohook 异常都走 `runtime-sync.ts` 合并请求，避免 reapply 期间同步重入
- **键盘手势状态机共享**：全局 uiohook 和窗口内 DOM backend 都复用 `shared/shortcuts/gesture-engine.ts`，避免 press / doublePress / hold 的判断在不同平台漂移
- **快捷键录制状态机共享**：设置页录制复用 `shared/shortcuts/record-engine.ts`，录制层只负责把 native / uiohook / DOM 事件归一为 `ShortcutRecordEvent`
- **runtime 暂停统一**：`suspension.ts` 在录制期间同时暂停 Fn 与全局 keyboard gesture engine
- **uiohook 共享生命周期**：`global/gesture` 和 `record/detector` 均通过 `uiohook-lifecycle` 共用同一个 Worker。首次消费者启动 native hook，后续只增减消费者引用与业务 listener；消费者归零不调用 `uIOhook.stop()`，Worker 已 `unref()` 并随 App 进程退出。`uiohook-napi` 的 native abort 无法由 Node Worker 隔离，不得把按会话 start/stop 加回来，也不得在 Electron 主线程直接调用
- **Swift 只归一物理输入**：native helper 输出 Fn/Fn combo 的 raw down/up/reset，不判断 press、doublePress、hold、scope 或 action
- **录制事件统一**：不同 backend 可以提供 `down/up` 或完整 `press`，但设置页只消费 `ShortcutRecordEvent`，不直接感知 Fn IPC、uiohook 或 DOM KeyboardEvent。录制状态机只输出 `gesture + chord`，保存边界才附加 `global/local` scope
- **抽象修饰键延迟归一**：配置里可以保留 `Primary`，运行时注册和冲突比较再映射为当前平台真实修饰键，避免把跨平台配置写死到某个系统
- **逻辑修饰键家族不可重复**：`Primary` 解析为当前平台修饰键后，不得再与同家族的 `Meta` 或 `Control` 并存；keyboard 与 Fn chord 使用同一持久化约束
- **普通键名只有一个持久化命名空间**：keyboard binding 使用 shared `KeyboardCode`；浏览器 code、旧配置别名和 uiohook 名称只在 adapter 边界转换，未知键在写入前拒绝
- **Fn backend 不拥有业务 UI**：`fn/runtime-backend` 只适配 raw input 并派发统一 runtime 事件；模板业务 handler 由 `main/index.ts` 注入
- **local keyboard 不依赖 main 进程全局监听**：Electron / Web 的 local keyboard binding 都走 renderer DOM backend；main 进程 keyboard provider 只负责系统级 global binding
- **设置页只录按键、不决定 scope**：录制产出 `gesture + chord`，保存时由动作声明补上 scope；可用 source 由 `ShortcutRuntimeCapabilities` 决定，而不是硬编码 `isElectron()`

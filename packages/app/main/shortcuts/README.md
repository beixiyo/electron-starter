# shortcuts — 快捷键子系统

所有快捷键相关的捕获、注册、录制逻辑集中在此目录，通过 `index.ts` 统一对外导出

## 目录结构

```
shortcuts/
  input/                     系统级键盘捕获后端（原始物理输入的唯一来源）
    backend.ts               KeyboardInputBackend 契约 + 订阅表
    index.ts                 按平台选定唯一后端：darwin → native-mac，其余 → uiohook
    native-mac/
      backend.ts             keyboard-listener Swift helper 的进程生命周期与健康状态
      protocol.ts            helper NDJSON v2 严格解码
    uiohook/
      backend.ts             uIOhook Worker 生命周期、授权门禁、键码归一
      keycodes.ts            uIOhook 键码表副本 + 键码 → 规范键名
      worker.ts              隔离运行 uiohook native addon，避免阻塞 Electron 主线程

  input-runtime-backend.ts   系统级 runtime backend：Fn 绑定 + 全局 keyboard 绑定接到同一条输入流
  fn-combo-suppression.ts    Fn 按住期间吞掉本 App 窗口里的组合成员键，避免字符落进输入框
  record/detector.ts         录制期间把输入流合成为 ShortcutRecordEvent 推给设置页

  system/                    macOS 当前启用的系统快捷键（symbolichotkeys plist 解码）
    index.ts                 plutil 读取、缓存与解码
    mac-keycodes.ts          macOS 虚拟键码表副本 + NSEvent 修饰键掩码

    state-manager.ts         长按状态追踪，供业务按自己的会话语义消费
    types.ts                 hold manager 内部状态与回调配置（main-only）

  capabilities.ts            配置能力 / 当前 runtime 能力过滤
  providers.ts               provider 声明（fn / keyboard / renderer-keyboard），可用性统一看输入后端
  runtime.ts                 过滤 binding 并调度 runtime backend
  runtime-backend.ts         backend 契约、注册项和统一事件派发
  runtime-sync.ts            权限或外部状态变化后的 runtime 重算通知
  scope.ts                   global / local scope 运行时门禁
  suspension.ts              录制期间统一暂停 main runtime
  cleanup.ts                 app will-quit 退出清理，import 时自动注册
  index.ts                   统一导出
```

## 分层

```
系统输入 ──► KeyboardInputBackend ──► KeyboardInput ──► KeyboardInputTracker ──► ShortcutRecordEvent ──► 手势 / 录制状态机
             (native-mac | uiohook)     统一原始输入        shared 合成 chord            统一 chord 事件           shared
```

- **原始输入层**（`shared/shortcuts/types.ts` 的 `KeyboardInput`）：每个后端只负责把系统输入归一成 `{ phase, key, modifiers, fn, timestamp }`，键名用统一的 `KeyboardCode`，Fn/Globe 用 `Fn`。系统自动重复由后端过滤
- **合成层**（`shared/shortcuts/input-tracker.ts`）：把原始输入合成 chord 事件。普通键在 down 时冻结此刻按住的物理修饰键与其他仍按住的普通键（`[ + ]`）；`fn: true` 且 Fn 已按住的普通键合成 Fn chord，同样带上其他仍按住的 Fn 组合键；修饰键永远走 keyboard 路径；Fn 松开按 down 顺序结束全部 Fn 组合
- **判定层**（`shared/shortcuts/input-runtime.ts` / `record-engine.ts`）：手势状态机与录制状态机只消费 chord 事件，main 系统级后端与 renderer DOM 后端共用同一份

渲染进程 DOM 是第三个后端：`shared/shortcuts/browser-key.ts` 把 `KeyboardEvent` 归一成同一种 `KeyboardInput`，`renderer/shortcuts/useShortcutRuntime.ts` 与录制 DOM 层走同一个 tracker

## 捕获后端对照

| 平台 | 后端 | 进程 | 能看到 Fn | 崩溃恢复 |
|---|---|---|---|---|
| macOS | `keyboard-listener` helper（CGEventTap，HID 层） | 独立子进程 | 是 | 异常退出后 5 秒恢复窗口，自动重启 |
| Windows / Linux | uIOhook（Worker 内 native addon） | App 进程 | 否 | Worker 一旦异常即标记不可用，只补启动不停止 |

后端可用性统一由 `keyboardInputBackend.isAvailable()` 决定：macOS 要求 App 与 helper 两处辅助功能授权都通过；Wayland 会话下 uIOhook 直接不可用，交给 DOM 兜底

## 关键约束

- **只有一条输入流**：Fn 组合、全局 keyboard、录制全部订阅同一个 `keyboardInputBackend`，不再各自建 tap。新增消费者只能 `acquire / subscribe / release`，不得直接碰 uiohook 或 helper
- **后端只归一物理事实**：`KeyboardInput` 不含 chord、手势、scope、action。哪个键属于 Fn 组合由后端用 `fn` 标记，但组合怎么合成由 shared tracker 决定
- **键名只有一个命名空间**：`KeyboardCode`（W3C `KeyboardEvent.code` 去掉 `Key` / `Digit` 前缀）。uIOhook 键码在 `input/uiohook/keycodes.ts` 转换，macOS 虚拟键码在 Swift `MacKeyCodes.swift` 转换，浏览器 `code` 在 `browser-key.ts` 转换；持久化边界不做别名兜底，未知键名直接拒绝
- **Fn 组合存物理键**：Apple 键盘驱动在 HID 层把 fn+Return / fn+Delete / fn+方向键改写成 Keypad Enter / Forward Delete / Home / End / PageUp / PageDown（`ioreg` 里的 `FnKeyboardUsageMap`），CGEvent 与 Chromium `code` 都只剩改写后的键。helper 在 Fn 已按住时还原成 `Enter` / `Backspace` / 方向键上报（`native/mac/README.md`），录制与运行时因此一致；只有 `fn-combo-suppression.ts` 拿的是 Chromium 的 `code`，靠 `FN_TRANSLATED_KEYS` 把绑定的物理键映射到翻译结果再比对
- **物理修饰键必须保留侧别**：`MetaLeft/MetaRight` 等作为 chord 成员严格匹配；声明式默认绑定可用逻辑修饰键 `Meta/Control/Alt/Shift/Primary`，表示同一家族至少按下一侧
- **修饰键状态偏离即撤销**：`input-runtime.ts` 每次 down/up 后用当前物理与逻辑修饰键校验每个 keyboard 注册项，不匹配的候选立即取消并释放已触发的 hold；裸 Fn 候选在 Fn 组合开始时撤销，`[` 候选在追加成员成 `[ + ]` 时撤销（`isShortcutChordPrefixOf`）
- **重载要清物理状态**：`updateEntries` 同时清手势与 tracker，否则按住中的键会在重载后被当成「已按住」丢弃下一次按下
- **runtime backend 与 provider 解耦**：`providers.ts` 只声明能力矩阵；`input-runtime-backend.ts` 一个 backend 同时认领 Fn 与有效 scope 为 global 的 keyboard 绑定，降级到 local 的 keyboard 绑定交给渲染进程 DOM backend，触发后经 `shortcutConfig.trigger` 回传主进程执行业务
- **scope 是动作语义，不是能力检测**：`SHORTCUT_ACTIONS[].scope` 声明该动作要不要在应用不在前台时触发，录制保存时原样沿用；当前能不能全局捕获由 `resolveEffectiveShortcutScope` 算出降级后的有效 scope，**降级结果只用于注册，不写回配置**，权限恢复后自动升回 global
- **runtime 重算入口统一**：配置变化、权限刷新、App activate、后端异常都走 `runtime-sync.ts` 合并请求，避免 reapply 期间同步重入
- **uIOhook 不可停止**：Worker 首次启动后驻留进程，消费者归零只减引用；native abort 无法由 Node Worker 隔离，不得把按会话 start/stop 加回来，也不得在主线程值导入 `uiohook-napi`（哪怕只为了 `UiohookKey` 常量，理由见 `input/uiohook/keycodes.ts` 的头注释）
- **Fn 组合成员键要在窗口层吞掉**：helper 恒定透传 CGEvent，`fn+X` 触发动作的同时那颗键照样打进聚焦的输入框（`fn+\`` 出反引号、`fn+Space` 出空格）。`fn-combo-suppression.ts` 只 `subscribe` 不 `acquire`，搭 `input-runtime-backend` 的引用计数顺风车，在 `before-input-event` 里对通过 `canTrigger` 门禁的组合键 `preventDefault`。这只管本 App 的窗口；别的 App 里仍会收到字符，治本需要 helper 在 tap 层 `return nil`
- **裸 Fn 绑定在场时由 helper 拦下系统的 🌐 键动作**：Fn 单击松开后系统合成 keyCode 0xB3 的 keyDown / keyUp，前台 App 据此开表情面板 / 切输入法。`input-runtime-backend` 在 apply 时按绑定表调用 `keyboardInputBackend.setGlobeKeySuppressed`，macOS 后端经 helper stdin 下发 `config` 命令（`native/mac/README.md`），helper 只吞这一对事件、不碰 flagsChanged；绑定清空或改成组合键时交还系统默认行为
- **录制校验规则是声明式的**：禁用键、键数上限、双击白名单全部写在 `shared/shortcuts/validation-policy.ts`，按数组顺序命中即返回；`validation.ts` 只是不含具体按键的执行引擎。新增禁用组合往 `patterns` 里加模式，新增失败原因要同步补 i18n 文案
- **系统快捷键只认写死在 plist 里的**：`system/` 读 `com.apple.symbolichotkeys`，但 macOS 对「从未被用户改过的系统默认快捷键」只落 `{ enabled: true }` 不落按键，那部分读不到。宁可漏报也不猜默认值——猜错会把一个完全可用的组合判成保留键，用户永远设不上。录制开始时读取本模块的实时结果并交给 shared 校验；本模块仍只负责读取与解码
- **Swift 只归一物理输入**：helper 输出每个键的 down/up/reset 与 `fn` 归属，不判断 chord、press、doublePress、hold、scope 或 action

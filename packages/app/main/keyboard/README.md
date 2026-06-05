# keyboard — 快捷键子系统

所有快捷键相关的检测、注册、录制逻辑集中在此目录，通过 `index.ts` 统一对外导出。

## 目录结构

```
keyboard/
  fn/                        Fn 键监听 + 手势状态机（macOS 专属）
    core.ts                  Swift 二进制通信层，解析 FN_DOWN / FN_UP / FN_COMBO_*
    state-machine.ts         300ms 决策状态机；手势互斥裁决、fn IPC 事件透传
    index.ts

  hold/                      长按相关的全部机制
    state-manager.ts         长按状态追踪（startTime / isHolding / onRelease）
    release-detector.ts      uiohook keyup 检测，感知按键松开时机
    shortcut.ts              公共 API：注册 / 取消注册长按全局快捷键
    resolve-key-group.ts     accelerator 字符串 → uiohook keycode 数组
    index.ts

  global/                    基于 Electron globalShortcut 的快捷键
    hotkey.ts                标准热键（⌘⌥R 等），注册 / 取消注册
    normal.ts                单次按下的普通全局快捷键
    double.ts                双击普通键检测，timer 判断双击间隔
    index.ts

  record/                    录制模式专用
    detector.ts              uiohook keydown 全局捕获修饰键组合，推送给渲染进程
    index.ts

  uiohook-lifecycle.ts       uiohook 引用计数管理，hold 与 record 共用一个 start/stop
  shortcut-utils.ts          日志格式化、冲突检测等工具函数
  types.ts                   公共类型定义（GlobalShortcutConfig / HoldGlobalShortcutConfig 等）
  local.ts                   应用内快捷键（占位，暂未实现）
  cleanup.ts                 app will-quit 退出清理，import 时自动注册
  index.ts                   统一导出
```

## 检测机制对照

| 手势 | 模块 | 机制 |
|---|---|---|
| fn + key (combo) | `fn/core` → `fn/state-machine` | Swift IOHID → `FN_COMBO_*` stdout |
| 双击 fn | `fn/state-machine` | 状态机 300ms 决策窗口 |
| 长按 fn | `fn/state-machine` | 300ms 超时进入 `HOLD_ACTIVE` |
| ⌘⌥R 等热键 **激活** | `global/hotkey` | Electron `globalShortcut.register` |
| ⌘⌥R 等热键 **录制** | `record/detector` | uiohook `keydown` 全局监听 |
| fn 手势 **录制** | `fn/state-machine` → IPC → renderer | 原始事件透传给渲染进程 |
| Cmd+E 长按普通键 | `hold/shortcut` + `hold/release-detector` | `globalShortcut`(↓) + uiohook(↑) |
| 双击普通键 | `global/double` | `globalShortcut` + timer |

## 关键约束

- **`suspended` 标志**：`fn/state-machine` 内维护，录制模式下 `suspendFnShortcuts()` 屏蔽所有 fn 手势触发；`global/hotkey` 的回调同样检查 `isSuspended()`。
- **uiohook 共享生命周期**：`hold/release-detector` 和 `record/detector` 均通过 `uiohook-lifecycle` 的引用计数共用同一个 `uIOhook.start/stop`，不得直接调用。
- **fn combo 由 Swift 报告**：combo 在 IOHID 层由 Swift 二进制合成后输出 `FN_COMBO_*`，主进程状态机不自己合成，避免跨事件源时序问题。

/** uIOhook 键码常量，供主进程在不加载 native addon 的前提下使用 */

/**
 * `uiohook-napi` 的 `UiohookKey` 键码表副本（复刻自 uiohook-napi@1.5.5）
 *
 * 实测症状：App 退出时必崩，`EXC_BREAKPOINT (SIGTRAP)` / `Trace/BPT trap: 5`，栈为
 * `node::Environment::RunCleanup → uiohook_worker_stop → hook_stop →
 * CFRunLoopCopyCurrentMode → __CFCheckCFInfoPACSignature`，落在主进程 CrBrowserMain 上
 *
 * 根因：`uiohook-napi` 的入口顶层就 `require('node-gyp-build')` 加载 addon，只要**值导入**
 * 它（哪怕只为了这张常量表）native 模块就会被装进当前线程的 Node Environment，而
 * `NAPI_MODULE_INIT` 会为每个 Environment 各注册一次 `napi_add_env_cleanup_hook`
 * 偏偏 addon 的 `is_worker_running` 与 libuiohook 的 `event_loop` 都是**进程级静态变量**，
 * 主线程和 Worker 共享同一份：Worker 的 cleanup 先 `hook_stop()` 停掉 hook 线程、销毁它的
 * CFRunLoop，却不复位 `is_worker_running`；主线程的 cleanup 于是再 stop 一次，对着已经悬垂的
 * `CFRunLoopRef` 取 mode，arm64e 的指针认证校验失败直接 `brk`
 *
 * 所以边界是：**只有真正要驱动 hook 的 `uiohook-worker.ts` 才可以值导入 `uiohook-napi`**，
 * 主进程其余地方一律用这张表；类型导入（`import type`）无运行时副作用，不受此限
 *
 * 治本要等上游把 `AddonCleanUp` 的状态复位补上、并把静态状态改成 per-Environment；在那之前
 * 主进程不能加载这个 addon。数值由上游模块求值导出，与 `UiohookKey` 逐项一致
 *
 * 值的类型故意收敛成 `number` 而不是字面量：上游声明里混有 `number` 类型的键，
 * 字面量联合被并成 `number`，消费方（如 `record/detector.ts` 的 `entry is [string, number]`
 * 谓词）都按 `number` 写；这里若用 `as const` 全字面量，联合不再塌缩，谓词会报 TS2677
 */
const UIOHOOK_KEY_TABLE = {
  0: 0x000B,
  1: 0x0002,
  2: 0x0003,
  3: 0x0004,
  4: 0x0005,
  5: 0x0006,
  6: 0x0007,
  7: 0x0008,
  8: 0x0009,
  9: 0x000A,
  Backspace: 0x000E,
  Tab: 0x000F,
  Enter: 0x001C,
  CapsLock: 0x003A,
  Escape: 0x0001,
  Space: 0x0039,
  PageUp: 0x0E49,
  PageDown: 0x0E51,
  End: 0x0E4F,
  Home: 0x0E47,
  ArrowLeft: 0xE04B,
  ArrowUp: 0xE048,
  ArrowRight: 0xE04D,
  ArrowDown: 0xE050,
  Insert: 0x0E52,
  Delete: 0x0E53,
  A: 0x001E,
  B: 0x0030,
  C: 0x002E,
  D: 0x0020,
  E: 0x0012,
  F: 0x0021,
  G: 0x0022,
  H: 0x0023,
  I: 0x0017,
  J: 0x0024,
  K: 0x0025,
  L: 0x0026,
  M: 0x0032,
  N: 0x0031,
  O: 0x0018,
  P: 0x0019,
  Q: 0x0010,
  R: 0x0013,
  S: 0x001F,
  T: 0x0014,
  U: 0x0016,
  V: 0x002F,
  W: 0x0011,
  X: 0x002D,
  Y: 0x0015,
  Z: 0x002C,
  Numpad0: 0x0052,
  Numpad1: 0x004F,
  Numpad2: 0x0050,
  Numpad3: 0x0051,
  Numpad4: 0x004B,
  Numpad5: 0x004C,
  Numpad6: 0x004D,
  Numpad7: 0x0047,
  Numpad8: 0x0048,
  Numpad9: 0x0049,
  NumpadMultiply: 0x0037,
  NumpadAdd: 0x004E,
  NumpadSubtract: 0x004A,
  NumpadDecimal: 0x0053,
  NumpadDivide: 0x0E35,
  NumpadEnter: 0x0E1C,
  NumpadEnd: 0xEE4F,
  NumpadArrowDown: 0xEE50,
  NumpadPageDown: 0xEE51,
  NumpadArrowLeft: 0xEE4B,
  NumpadArrowRight: 0xEE4D,
  NumpadHome: 0xEE47,
  NumpadArrowUp: 0xEE48,
  NumpadPageUp: 0xEE49,
  NumpadInsert: 0xEE52,
  NumpadDelete: 0xEE53,
  F1: 0x003B,
  F2: 0x003C,
  F3: 0x003D,
  F4: 0x003E,
  F5: 0x003F,
  F6: 0x0040,
  F7: 0x0041,
  F8: 0x0042,
  F9: 0x0043,
  F10: 0x0044,
  F11: 0x0057,
  F12: 0x0058,
  F13: 0x005B,
  F14: 0x005C,
  F15: 0x005D,
  F16: 0x0063,
  F17: 0x0064,
  F18: 0x0065,
  F19: 0x0066,
  F20: 0x0067,
  F21: 0x0068,
  F22: 0x0069,
  F23: 0x006A,
  F24: 0x006B,
  Semicolon: 0x0027,
  Equal: 0x000D,
  Comma: 0x0033,
  Minus: 0x000C,
  Period: 0x0034,
  Slash: 0x0035,
  Backquote: 0x0029,
  BracketLeft: 0x001A,
  Backslash: 0x002B,
  BracketRight: 0x001B,
  Quote: 0x0028,
  Ctrl: 0x001D,
  CtrlRight: 0x0E1D,
  Alt: 0x0038,
  AltRight: 0x0E38,
  Shift: 0x002A,
  ShiftRight: 0x0036,
  Meta: 0x0E5B,
  MetaRight: 0x0E5C,
  NumLock: 0x0045,
  ScrollLock: 0x0046,
  PrintScreen: 0x0E37,
} as const

/** 供主进程使用的 uIOhook 键码表，来源、边界与类型取舍见上方说明 */
export const UiohookKey: { readonly [K in keyof typeof UIOHOOK_KEY_TABLE]: number } = UIOHOOK_KEY_TABLE

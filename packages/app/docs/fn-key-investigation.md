# Fn/Globe 键监听：从「输入监控」到「仅辅助功能」的排查记录

> 背景：打包后 app 会向用户索取 **输入监控（Input Monitoring）** 权限，产品要求「宁可砍掉功能，也不要这个权限」。本文记录为什么会要、试过哪些路、为什么都不行，以及最终怎么做到 **只用「辅助功能」** 就能稳定读 Fn 键

## TL;DR

把 Fn 键监听从 `IOHIDManager` 换成 **`CGEvent.tapCreate(tap: .cghidEventTap, options: .defaultTap)`**（HID 层的主动事件 tap）：

- ✅ **只需「辅助功能」权限，不要「输入监控」**
- ✅ **在 Karabiner-Elements 下也能稳定读到 Fn**（连 `maskSecondaryFn` 标志都是活的）
- ✅ 对外 `FN_DOWN` / `FN_UP` / `FN_COMBO_<key>` 协议不变 → 主进程、`core.ts`、`shortcuts.ts` **零改动**

实测（真实 Electron，`electron-vite dev`，开着 Karabiner 的机器）：长按 / 双击 / Fn+Space 三种模式全部正常，全程**没有**输入监控弹窗

> **⚠️ 核心结论（务必先看）**：真正的修复**只有一条** —— 把 `IOHIDManager` 换成**任何「辅助功能层」的键盘 API**（CGEventTap 即可），权限就从「输入监控」降到「辅助功能」。**`.cghidEventTap` vs `.cgSessionEventTap`、Karabiner、Globe 键设置都不是关键** —— 真机实测 **session 层和 HID 层都能用**。本文档早期据命令行探针得出的「必须用 HID / session 会漏 Fn」是**错的**（CLI 探针与真实 Electron app 的 tap 行为不同，见下「命令行探针 vs 真实 app」）。最终选 HID，只是因为它额外保住了 `maskSecondaryFn` 标志、检测更干净，**不是因为 session 不行**

---

## 一、为什么旧方案会要「输入监控」

旧 `fn-listener.swift` 用 **`IOHIDManager` 读键盘原始 HID 事件**。macOS 上「用 IOHID 打开并读取键盘类设备」正是 `kTCCServiceListenEvent`（输入监控）所管的行为 —— `IOHIDManagerOpen` 在没授权时返回 `kIOReturnNotPermitted`

> 顺带澄清一个常见困惑：**dev 不弹、打包才弹**，不是打包多要了权限，而是 TCC 按「责任进程（responsible process）+ 代码签名身份」记账。dev 跑的 `Electron.app` 身份你可能授权过（或终端的授权被继承），打包后是 app 自己全新的、ad-hoc 签名的身份，从没授权过 → 必弹

---

## 二、试过的路（以及为什么不行）

| 方案 | 工作的「层」 | Karabiner 下能读 Fn？ | 权限 | 结论 |
|---|---|---|---|---|
| `IOHIDManager`（旧） | HID（原始设备） | ✅ 稳 | ❌ **输入监控** | 被产品否决 |
| `NSEvent.addGlobalMonitorForEvents(.flagsChanged)` + `.function` | cooked（Cocoa） | ❌ `.function` 恒 false、事件大量丢 | 辅助功能 | Karabiner 把标志剥了、把事件吞了 |
| `CGEventSource.keyState(63)` / 翻转法 | — | keyState 恒 false；翻转掉边沿 → 打字被误判成组合键 | 辅助功能 | 不可靠、会污染正常输入 |
| `CGEventTap` **`.cgSessionEventTap`** | session | ✅ 真机能用（CLI 探针误报为漏） | ✅ 辅助功能 | 可用；标志被剥成 0，靠翻转判定（Typeless 即用此层） |
| `CGEventTap` **`.cghidEventTap`** ✅ | **HID** | ✅ 稳，**标志还活着** | ✅ **仅辅助功能** | **最终选用**（与 session 同样可行，胜在标志可靠） |

**命令行探针 vs 真实 app（重要修正）**：单独用命令行跑探针时，session 层只收到约 1/5 的 Fn 事件、像是"被吞"；**但在真实 Electron app 里，session 层 Fn 事件正常到达、功能正常**。所以"session 会漏"是 **CLI 探针的假象**（命令行下责任进程 / tap 健康度与 Electron 不同），不是真相

真机实测（`FN_TAP=session` vs 默认 hid 对比），两层都能用，唯一区别是**标志**：

```
.cgSessionEventTap →  flags=0x100      secondaryFn=false  （标志被剥，靠 keyCode==63 翻转判定，照常工作）
.cghidEventTap     →  flags=0x800100   secondaryFn=true   （标志完好，直接用 flag 判定，更干净）
两层的 [fn:raw] DOWN/UP、[fn:double]、[fn:combo] 均正常触发
```

---

## 三、关键原理：事件流的「三层」

一次 Fn/Globe 按键，从硬件到 app 经过多层处理，**每一层能看到的东西不一样**：

```
物理 Globe 键(apple_vendor_top_case 0x00FF)
   │
   ├─ IOHID 原始层 ……………… IOHIDManager 在此读（要输入监控）
   │
   ├─ HID 事件层 ……………… .cghidEventTap 在此 ← 我们用这里
   │      ↑ 此处之前：Globe 完整、maskSecondaryFn 标志完好
   │
   ├─ ★ Karabiner 虚拟键盘重注入：会剥掉 maskSecondaryFn 标志
   ├─ ★ 系统按「按🌐键时」设置消费 Globe（多输入法默认=切换输入法）
   │
   ├─ session 事件层 …………… .cgSessionEventTap 在此（Fn 事件仍到达，但标志已被剥成 0）
   │
   └─ cooked / Cocoa 层 ……… NSEvent 全局监听在此（同上：标志没了但事件在，也能用）
```

**`.cghidEventTap` 的好处是它在「Karabiner 剥标志」之前，所以 `maskSecondaryFn` 标志完好。** session 层 / NSEvent 层在之后，**标志被剥成 0 —— 但 Fn 事件本身照常到达，靠 `keyCode==63` 翻转判定仍然准确**，所以两层都能用，HID 只是检测更干净
> 早期"session 会漏 Fn"的说法是**命令行探针的假象**（真机不漏，见上）；"系统消费 Globe（切输入法）"对 HID 层无影响、对 session 层也只是改了输入法、不挡 Fn 事件，所以**改不改「按🌐键时」都无所谓**

这也解释了为什么 **微信输入法 / Typeless 在同一台机器上"正常"**：微信输入法靠的是输入法通道（Globe→切换输入法，本就是系统行为）；Typeless 反编译可见它用的正是 **`kCGSessionEventTap` 主动 tap + keyCode 63 + maskSecondaryFn**（IOHID 只用于设备枚举、不 open），且只申请辅助功能 —— 思路一致，我们用更底的 HID 层把 Karabiner 这关也过了

---

## 四、TCC 权限模型（三个独立服务，别混）

| TCC 服务 | 系统设置位置 | 谁需要它 |
|---|---|---|
| `kTCCServiceAccessibility` | 隐私 → **辅助功能** | 完整 AX 控制、`NSEvent` 全局键盘监听 |
| `kTCCServicePostEvent` | 隐私 → **辅助功能**（同一栏、独立条目） | **主动 CGEventTap（`.defaultTap`）**、`CGEventPost` |
| `kTCCServiceListenEvent` | 隐私 → **输入监控** | **被动 CGEventTap（`.listenOnly`）**、IOHID 读键盘 |

要点（来自 Apple DTS Quinn 在开发者论坛的多次确认）：

- **主动 tap（`.defaultTap`）走 PostEvent，显示在「辅助功能」面板里，不是「输入监控」。** 被动 tap（`.listenOnly`）才走输入监控
- 完整「辅助功能」授权会**覆盖** PostEvent —— app 本来就为 `focus-check`（AXUIElement）/ 自动打字申请了辅助功能，所以 tap 直接就有权限
- 实测佐证：把 `ListenEvent` 表清空、仅 `AXIsProcessTrusted()=true` 时，`.cghidEventTap + .defaultTap` 仍能创建并收到事件 → 坐实**只要辅助功能**

---

## 五、最终实现要点（`resources/fn-listener.swift`）

```swift
CGEvent.tapCreate(
  tap: .cghidEventTap,        // HID 层（关键）
  place: .headInsertEventTap,
  options: .defaultTap,       // 主动 tap → PostEvent（辅助功能），非输入监控
  eventsOfInterest: flagsChanged | keyDown,
  ...
)
```

- **Fn 判定**：`flagsChanged` 中 `keyCode == 63`（kVK_Function）。优先用 `maskSecondaryFn` 标志判 down/up（HID 层标志可靠）；标志缺失时退回翻转（兜底极端情况）
- **组合键**：必须先由 `keyCode == 63` 的 `flagsChanged` 确认 Fn 已按下，再把 `keyDown` 识别为 `FN_COMBO_<key>`；不能单靠 `keyDown` 上的 `maskSecondaryFn`，因为方向键等 function/navigation key 自身也可能携带这类标志。**无标志的普通打字强制清零 `fnDown` 并补 `FN_UP`** —— 杜绝掉边沿后把正常打字误判成组合键（这是早期翻转法的污染 bug，已修）。另加 0.6s 时间窗，让 Karabiner 下的 Fn+Space 也能识别
- **键名映射**：回调里用 **虚拟键码 `kVK_*`**（如 `Space=49`），不是 HID usage —— 这是从 IOHID 迁到 CGEvent 时最容易踩的坑
- **健壮性**：处理 `tapDisabledByTimeout/UserInput` 自动重启 tap；回调始终 `return Unmanaged.passUnretained(event)` 透传不拦截；每 5s 检测父进程存活（`getppid()==1` 退出）
- **对外协议不变**：`FN_DOWN` / `FN_UP` / `FN_COMBO_<key>`，`core.ts` 与 `shortcuts.ts` 无需改动

---

## 六、坑与注意事项

- **「按🌐键时」设置**：存在 `com.apple.HIToolbox` 域的 `AppleFnUsageType`（`0`=不执行 `1`=切换输入法 `2`=Emoji `3`=听写），**不是** `-g` 全局域。多输入法时默认 `1`，会在 session 层吃掉 Globe —— 但 **HID 层不受它影响，所以无需改这个设置**（用户可继续用 Globe 切输入法）
- **回调要快**：`.cghidEventTap` 在很底层，回调里别做重活，否则会被系统以 timeout 禁用
- **CLI 自测的假象**：命令行直接跑探针时，重新编译会改变 cdhash → 可能出现「tap 非 nil 但收不到事件」的静默失效；正式由 Electron（持有辅助功能）spawn 时正常
- **打包前复验**：确认打包后的 `.app` 申请了辅助功能（`electron-builder.yml` 的 `NSAccessibilityUsageDescription`），并复测 `.cghidEventTap` 仍只要辅助功能；可移除任何已无用的输入监控相关声明。`build:native` 产出 universal binary

---

## 七、参考

- Apple Developer Forums，Quinn「The Eskimo!」：thread 735204 / 744440 / 789896 / 707680（PostEvent vs ListenEvent 三服务、CGEventTap 权限）
- Typeless 反编译：`libKeyboardHelper.dylib` = `CGEventTapCreate(session, defaultTap)` + keyCode 63 + `maskSecondaryFn`；IOHID 仅 `CopyDevices` 枚举
- 开源参照：`norflin321/fn-lang-switcher`（NSEvent + 辅助功能，README 要求把 Globe 设为 Do Nothing）、`OpenWhispr/openwhispr`（Electron + Swift globe-listener，文档明示无需输入监控）、`Pyroh/Fluor`
- Apple 开源 `IOHIDFamily/AppleEmbeddedKeyboard.cpp`：Globe = `kHIDPage_AppleVendorTopCase(0xFF) / kHIDUsage_AV_TopCase_KeyboardFn(0x03)`

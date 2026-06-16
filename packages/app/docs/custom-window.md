# 自绘无边框窗口

## 为什么需要自绘

Electron 默认窗口带有系统标题栏和边框。要实现完全自定义的 UI（圆角、自定义阴影、异形窗口），需要：
1. 隐藏系统窗口 chrome
2. 让窗口背景完全透明
3. 在 HTML/CSS 层自己绘制所有可见元素

## 核心配置

### BrowserWindow 选项

```ts
new BrowserWindow({
  frame: false,
  transparent: true,
  backgroundColor: '#00000000',
  hasShadow: false,
})
```

| 选项 | 值 | 说明 |
|------|-----|------|
| `frame` | `false` | 移除系统标题栏和边框 |
| `transparent` | `true` | 启用窗口透明 |
| `backgroundColor` | `'#00000000'` | 窗口背景色设为全透明（8 位 hex，最后两位 `00` 是 alpha） |
| `hasShadow` | `false` | **必须关闭**。macOS 透明窗口的原生阴影沿窗口矩形绘制，不跟 CSS 圆角走，会产生可见的方角边框 |

### HTML/CSS 层透明

Electron 的 `transparent: true` 只让窗口容器透明。如果 CSS 给 `html`/`body`/`#root` 设了背景色（比如全局 reset.css），白色背景会填满窗口矩形，圆角外面露出方角——看起来像一圈边框

在入口文件（如 `voice-ime.tsx`）中用 JS 强制覆盖：

```ts
document.documentElement.style.background = 'transparent'
document.body.style.background = 'transparent'
document.getElementById('root')!.style.background = 'transparent'
```

> 为什么不用 CSS？因为全局 reset.css 可能用了 `:root, body, #root { background-color: ... }` 选择器，行内样式的优先级才足以覆盖。JS 设置 `element.style` 等同于行内样式

### 内容区域自绘

窗口本身完全透明后，在 React 组件里自己画圆角和阴影：

```tsx
<div className="bg-background rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]">
  {/* 窗口内容 */}
</div>
```

### 阴影样式

模拟 macOS 原生窗口阴影，使用双层 `box-shadow`：

```css
shadow-[0_2px_8px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]
```

| 层 | offset | blur | 作用 |
|----|--------|------|------|
| 近层 | `0 2px 8px` | `rgba(0,0,0,0.08)` | 底边紧贴的浅阴影，给窗口"着地感" |
| 远层 | `0 8px 24px` | `rgba(0,0,0,0.12)` | 大范围扩散，模拟环境光遮蔽 |

### 阴影留白

CSS `box-shadow` 渲染在元素边界之外。Electron 透明窗口的可渲染区域 = 窗口尺寸，阴影超出部分会被裁掉

解决方案：窗口比内容大一圈，用 padding 留出阴影空间

**SHADOW_INSET 必须 ≥ 阴影最大扩散半径**。上面的阴影远层 blur 为 `24px`、offset-y 为 `8px`，最远扩散到 `24 + 8 = 32px`，所以 `SHADOW_INSET = 30` 是安全值（底部略有裁剪可接受）。设太小（如 10）会导致阴影在窗口边缘被硬切

```ts
// constants.ts
export const SHADOW_INSET = 30

export const VIEW_SIZE = {
  normal: { width: 280 + SHADOW_INSET * 2, height: 120 + SHADOW_INSET * 2 },
}
```

```tsx
// 外层透明容器撑满窗口，padding 留出阴影空间
<div style={{ padding: SHADOW_INSET }}>
  {/* 内层是实际可见的自绘内容 */}
  <div className="bg-background rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]">
    ...
  </div>
</div>
```

### macOS 已知限制

| 限制 | 说明 |
|------|------|
| 透明窗口无原生阴影 | [Electron 官方文档](https://www.electronjs.org/docs/latest/api/frameless-window#limitations)："On Mac, the native window shadow will not be shown on a transparent window" |
| `hasShadow: true` 产生方角边框 | 原生阴影沿窗口矩形绘制，不跟 DOM 圆角走 |
| DevTools 影响透明 | 内嵌 DevTools 会破坏透明度，用 `{ mode: 'detach' }` 分离到独立窗口 |

## macOS 全屏 Space 上的辅助浮窗

### 问题现象

用户点击 macOS 红绿灯最右侧按钮进入原生全屏后，主窗口会被系统放进独立的 fullscreen Space。此时如果长按 Fn 打开 Voice IME 这类独立 Electron 浮窗，可能出现：

- 系统切到一个新的黑屏 Space
- 浮窗像是被系统另开了一个窗口，而不是贴在全屏主窗口上
- 主窗口仍在全屏，但 Voice IME 不在同一个 Space 内

这不是 React 渲染问题，也不是 `alwaysOnTop` 不够高。macOS 原生全屏不是普通最大化；普通窗口默认不能加入另一个 fullscreen Space

### 根因

`alwaysOnTop: true` 只影响窗口层级，不会让窗口加入 fullscreen Space。要让同一个 app 的辅助浮窗显示在全屏主窗口上，窗口必须具备 macOS 的 full-screen auxiliary / panel 语义

Apple 对应能力是 `NSWindow.CollectionBehavior.fullScreenAuxiliary`，Electron 对应能力是：

- `BrowserWindow` 使用 `type: 'panel'`
- 创建后调用 `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`
- 再调用 `setFullScreenable(false)`，避免辅助窗自己参与原生全屏

### 推荐配置

在窗口配置里给需要覆盖全屏主窗口的浮窗加一个显式开关：

```ts
// shared/window-config/types.ts
export interface WindowConfig extends BrowserWindowConstructorOptions {
  /**
   * macOS 原生全屏 Space 辅助窗口。
   * 用于 Voice IME / 截图蒙层这类需要显示在绿灯全屏窗口上的浮窗。
   *
   * @default false
   */
  macFullscreenAuxiliary?: boolean
}
```

Voice IME 这类窗口启用它：

```ts
// shared/window-config/constants.ts
[WindowType.VOICE_IME]: {
  width: 220,
  height: 64,
  position: 'bottom-center',
  frame: false,
  transparent: true,
  backgroundColor: '#00000000',
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  movable: false,
  focusable: true,
  hasShadow: false,
  htmlPath: 'windows/voice-ime/index.html',
  show: false,
  macFullscreenAuxiliary: true,
}
```

在窗口工厂统一落地 macOS 行为：

```ts
// main/window-manager/window-factory.ts
const {
  position,
  htmlPath,
  initialUrl,
  width: rawWidth,
  height: rawHeight,
  macFullscreenAuxiliary,
  ...browserWindowConfig
} = config

const browserWindowOptions: BrowserWindowConstructorOptions = {
  width,
  height,
  x,
  y,
  frame: browserWindowConfig.frame ?? true,
  transparent: browserWindowConfig.transparent ?? false,
  alwaysOnTop: browserWindowConfig.alwaysOnTop ?? true,
  skipTaskbar: browserWindowConfig.skipTaskbar ?? false,
  resizable: browserWindowConfig.resizable ?? true,
  movable: browserWindowConfig.movable ?? true,
  focusable: browserWindowConfig.focusable ?? true,
  hasShadow: browserWindowConfig.hasShadow ?? true,
  ...browserWindowConfig,
}

if (macFullscreenAuxiliary && process.platform === 'darwin') {
  browserWindowOptions.type = 'panel'
}

const window = new BrowserWindow(browserWindowOptions)
applyMacFullscreenAuxiliary(window, macFullscreenAuxiliary)

function applyMacFullscreenAuxiliary(window: BrowserWindow, enabled?: boolean): void {
  if (!enabled || process.platform !== 'darwin') {
    return
  }

  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  })
  window.setFullScreenable(false)
}
```

### 验证方式

1. 完整重启 Electron 主进程。窗口创建参数只在创建时生效，渲染层热更新不够
2. 点击主窗口绿灯进入 macOS 原生全屏
3. 长按 Fn 打开 Voice IME
4. 预期：Voice IME 出现在同一个 fullscreen Space 内，不切到黑屏 Space

### 常见误区

| 误区 | 正确认知 |
|------|----------|
| 提高 `alwaysOnTop` level 即可 | `alwaysOnTop` 不负责 Space 归属，仍可能被系统放到别的 Space |
| 这是透明窗口 CSS 问题 | 黑屏/切 Space 通常发生在 AppKit 窗口管理层，和 DOM 背景透明不是一类问题 |
| 所有窗口都该开 `visibleOnFullScreen` | 只给 Voice IME、截图蒙层这类确实需要盖在全屏主窗上的辅助浮窗开启 |
| 创建时设置 `fullscreenable: false` 一定等价 | Electron/macOS 上更稳的顺序是先 `setVisibleOnAllWorkspaces(... visibleOnFullScreen ...)`，再 `setFullScreenable(false)` |

## 窗口拖拽

无边框窗口没有系统标题栏，需要用 CSS `-webkit-app-region: drag` 手动指定可拖拽区域

### 前提条件

BrowserWindow 配置必须 `movable: true`，否则 CSS drag 不生效：

```ts
new BrowserWindow({
  frame: false,
  movable: true,  // 必须
})
```

### CSS 实现

```tsx
{/* 容器可拖拽，内部所有 button 排除 */}
<div className="[-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]">
  <span>拖这里移动窗口</span>
  <button>点击不受影响</button>
</div>
```

| 属性 | 作用 |
|------|------|
| `-webkit-app-region: drag` | 该区域可拖拽移动窗口 |
| `-webkit-app-region: no-drag` | 排除拖拽，恢复正常交互 |

### 注意事项

- `drag` 区域内的所有交互事件（click、hover 等）会被吞掉，所以按钮、链接必须加 `no-drag`
- 用 `[&_button]:[-webkit-app-region:no-drag]` 一次性排除所有 button 子元素，避免逐个标注
- 透明窗口的 padding 留白区如果也设了 `drag`，用户会在不可见区域触发拖拽，体验很怪——只给可见内容区加 `drag`

## 窗口尺寸丝滑过渡

当窗口需要在多种形态之间切换（如录音态 → 结果态），需要窗口尺寸和内容同时平滑过渡

### 架构

```
渲染进程 (motion/react)          主进程 (Electron)
┌──────────────────────┐       ┌──────────────────────┐
│ motion.div           │       │ windowManager        │
│   animate={{ w, h }} │──IPC──│   .resizeTo(w, h)    │
│   spring 弹性动画    │       │   setBounds(animate) │
└──────────────────────┘       └──────────────────────┘
```

两层动画同时进行：
- **CSS 层**：`motion.div` 的 `animate` 属性驱动内容区域的宽高变化，使用 spring 物理弹性
- **窗口层**：通过 IPC 调用主进程的 `windowManager.resizeTo()`，macOS 的 `setBounds(bounds, true)` 提供原生过渡

### 渲染进程

```tsx
import { AnimatePresence, motion } from 'motion/react'

const VIEW_SIZE = {
  recording: { width: 300, height: 140 },
  result:    { width: 340, height: 220 },
}

// 切换视图时同时通知主进程 resize
function switchView(next: ViewMode) {
  setViewMode(next)
  const size = VIEW_SIZE[next]
  $ipc.window.resizeTo(WindowType.VOICE_IME, size.width, size.height, true)
}

return (
  <div style={{ padding: SHADOW_INSET }}>
    <motion.div
      className="bg-background rounded-2xl shadow-[...]"
      animate={{
        width: currentSize.width - SHADOW_INSET * 2,
        height: currentSize.height - SHADOW_INSET * 2,
      }}
      transition={{ type: 'spring', stiffness: 400, damping: 35 }}
    >
      <AnimatePresence mode="wait">
        {viewMode === 'recording'
          ? <motion.div key="recording" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <RecordingView />
            </motion.div>
          : <motion.div key="result" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <ResultView />
            </motion.div>
        }
      </AnimatePresence>
    </motion.div>
  </div>
)
```

### 主进程

```ts
// window-manager.ts
resizeTo(type: WindowType, width: number, height: number, animate = false): boolean {
  const win = this.windows.get(type)
  if (!win || win.isDestroyed()) return false

  const current = win.getBounds()
  const display = screen.getDisplayNearestPoint({
    x: current.x + current.width / 2,
    y: current.y + current.height / 2,
  })
  const workArea = display.workArea

  // 水平居中，底边锚定（向上扩展）
  const x = Math.round(workArea.x + (workArea.width - width) / 2)
  const y = current.y + current.height - height

  win.setBounds({ x, y, width, height }, animate)
  return true
}
```

通过 IPC 暴露给渲染进程：

```ts
// window handlers
resizeTo: async (_event, type, width, height, animate?) => {
  const success = windowManager.resizeTo(type, width, height, animate)
  return { success }
}

// window API (preload)
methods: ['create', 'show', 'hide', ..., 'resizeTo']
```

### 动画参数选择

| 参数 | 值 | 说明 |
|------|-----|------|
| `type` | `'spring'` | 物理弹性，比 `tween` 更自然 |
| `stiffness` | `400` | 偏高 → 响应快 |
| `damping` | `35` | 偏高 → 不过冲，干脆利落 |

`AnimatePresence mode="wait"` 确保旧内容退出后再进新内容，避免两个视图同时存在

## 拖拽四角缩放 + 尺寸持久化

上一节的 `resizeTo` 是**应用驱动**（程序在预设形态间切换）。这一节是**用户驱动**：让用户拖窗口四角/四边自由改尺寸，并把结果持久化、下次打开还原

### 为什么自绘手柄，而不用原生 resize

透明无边框窗有两个坎，导致原生边缘缩放不可用：

1. 窗口真实边缘落在 **SHADOW_INSET 阴影留白**里，离可见内容差着 30px——原生 resize 热区在透明区，用户根本抓不到可见边角
2. `transparent: true` + `hasShadow: false` 下，原生边缘手柄既不可见、命中也别扭

所以走**渲染层自绘四角/四边手柄**（对齐可见内容边角）+ 指针捕获，把新尺寸经 IPC 交给主进程 `setBounds`。这套与具体窗口解耦，任意透明窗挂上 `<ResizeHandles>` 即获得能力

### 架构

```
渲染进程                                   主进程 (Electron)
┌─────────────────────────────┐          ┌────────────────────────────────┐
│ <ResizeHandles>             │          │ windowManager.setBounds()        │
│   8 个透明手柄(角+边)       │          │                                  │
│ useWindowResize             │          │ create(): persistBounds 时       │
│   pointerdown→指针捕获      │──setBounds│   回填 getSavedBounds+clampToScreen │
│   pointermove→算 bounds     │   (IPC)  │   监听 resize/move               │
│   rafThrottle 逐帧提交      │          │        │                         │
└─────────────────────────────┘          └────────┼─────────────────────────┘
                                                   │ saveBounds(防抖)
                                                   ▼
                                          userData/window-bounds.json
```

### 渲染层

- **`ResizeHandles.tsx`**：`absolute` 覆盖层，`inset` 对齐可见内容边角（透明窗传 `SHADOW_INSET`）；渲染 8 个透明手柄（4 角 + 4 边），各自带 `cursor-nwse/nesw/ns/ew-resize` 光标，且必须 `[-webkit-app-region:no-drag]`（否则被拖拽区吞掉）
- **`useWindowResize.ts`**：拖拽核心逻辑
  - `pointerdown` → `setPointerCapture` 锁定指针（移出手柄也持续收事件），异步取一次起始 bounds
  - `pointermove` → 用**屏幕坐标增量**算新 bounds，方位字符判定（含 `e/w` 改宽、`s/n` 改高，含 `w/n` 同步移动原点），触达 min/max 时锁住被拖边、对侧锚点不动
  - 经 `rafThrottle`（`@jl-org/tool`）**逐帧节流**调 `$ipc.window.setBounds`，避免高频 IPC 卡顿

```tsx
// 任意透明窗挂载即可（ShortcutTestApp.tsx 为例）
<div className="relative w-screen h-screen" style={{ padding: SHADOW_INSET }}>
  {/* 可见内容 */}
  <div className="bg-background rounded-2xl shadow-[...]">...</div>

  <ResizeHandles
    windowType={WindowType.SHORTCUT_TEST}
    inset={SHADOW_INSET}            // 对齐可见边角
    minWidth={280 + SHADOW_INSET * 2}
    minHeight={180 + SHADOW_INSET * 2}
  />
</div>
```

### 主进程

`setBounds` / `getBounds` 直接读写窗口 bounds；尺寸下限由窗口自身 `minWidth/minHeight` 兜底（Electron 原生裁剪）：

```ts
// window-manager.ts
setBounds(type, bounds, animate = false) {     // 高频调用，默认不开动画
  const win = this.windows.get(type)
  if (!win || win.isDestroyed()) return false
  win.setBounds({ ...win.getBounds(), ...bounds }, animate)
  return true
}
```

持久化由 `config.persistBounds` 开关驱动，集中在 `create()`：

```ts
// create() 内
if (config.persistBounds) {
  const saved = getSavedBounds(type)
  if (saved) {                                 // 回填上次尺寸/位置
    const c = this.clampToScreen(saved)        // 裁进当前显示器，防还原到屏外
    config.width = c.width; config.height = c.height
    config.position = { x: c.x, y: c.y }
  }
}
// 创建后监听 resize/move → saveBounds（内部防抖）
window.on('resize', persist)
window.on('move', persist)
```

### 持久化存储

| 项 | 值 |
|----|----|
| 位置 | `app.getPath('userData')/window-bounds.json`（macOS：`~/Library/Application Support/<appName>/window-bounds.json`） |
| 格式 | JSON，按 `WindowType` 作 key 的 map，每项存完整 `{ x, y, width, height }`（含阴影留白，屏幕坐标 DIP） |
| 写入 | 窗口 `resize`/`move` 触发，**300ms 防抖**合并写整个 map（`bounds-store.ts`，主进程用 Node 原生 `setTimeout`，不依赖 `window`） |
| 读取 | `create()` 时回填，经 `clampToScreen` 裁进最近显示器工作区 |

### 让某个窗口支持缩放：三步

1. **配置**（`shared/window-config/constants.ts`）：该窗口加 `resizable: true`、`minWidth`/`minHeight`、`persistBounds: true`
2. **IPC**：`setBounds`/`getBounds` 已在 `ipc/services/window/{contract,client,service}.ts` 暴露，无需改动
3. **UI**：在该窗口根容器（`relative`）挂 `<ResizeHandles windowType inset minWidth minHeight />`

### 与 resizeTo 的区别

| | `resizeTo`（上一节） | 拖拽四角缩放（本节） |
|--|--------------------|---------------------|
| 驱动方 | 应用（预设形态切换） | 用户（自由拖拽） |
| 定位策略 | 水平居中 + 底边锚定 | 拖动边变化、对侧锚点不动 |
| 动画 | `setBounds(animate=true)` 原生过渡 | 逐帧无动画，跟手 |
| 持久化 | 无 | `persistBounds` 落盘还原 |

### 涉及文件

| 文件 | 职责 |
|------|------|
| `renderer/windows/shared/ResizeHandles.tsx` | 四角 + 四边透明手柄覆盖层（含方向光标） |
| `renderer/windows/shared/useWindowResize.ts` | 拖拽核心：指针捕获 + 屏幕坐标增量算 bounds + min/max 锚点 + rafThrottle 逐帧提交 |
| `renderer/windows/shared/index.ts` | barrel 导出 |
| `main/window-manager/window-manager.ts` | `setBounds`/`getBounds`/`clampToScreen`，create 时回填 + 监听 resize/move 落盘 |
| `main/window-manager/bounds-store.ts` | bounds 持久化（`userData/window-bounds.json`，防抖写） |
| `shared/window-config/types.ts` | `WindowConfig.persistBounds` 开关 + `WindowBounds` 类型 |
| `shared/window-config/constants.ts` | 目标窗口 `resizable`/`minWidth`/`minHeight`/`persistBounds` 配置（演示宿主：`SHORTCUT_TEST`） |
| `ipc/services/window/{contract,client,service}.ts` | `setBounds`/`getBounds` IPC 契约 + 实现 |
| `renderer/windows/shortcut-test/ShortcutTestApp.tsx` | 接入示例（托盘可直接打开验证） |

## 核心文件

| 文件 | 职责 |
|------|------|
| `shared/window-config/constants.ts` | 窗口配置（transparent、backgroundColor、hasShadow） |
| `renderer/voice-ime.tsx` | 入口，JS 强制 html/body/root 透明 |
| `renderer/VoiceImeApp/constants.ts` | SHADOW_INSET、各形态尺寸定义 |
| `renderer/VoiceImeApp/VoiceImeApp.tsx` | motion.div 容器动画 + AnimatePresence 内容切换 |
| `main/window-manager.ts` | `resizeTo()` 方法，水平居中 + 底边锚定 |
| `ipc/services/window/` | resizeTo IPC handler + API |

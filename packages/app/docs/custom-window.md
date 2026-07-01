# 自绘无边框窗口

本文只记录当前统一方案：**透明 `BrowserWindow` + CSS shadow + 动态点击穿透**。目标是保留无边框圆角阴影，同时避免透明阴影区域挡住后方点击

## 核心配置

透明无边框窗口统一关闭原生阴影：

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
| `transparent` | `true` | 允许窗口背景透明 |
| `backgroundColor` | `'#00000000'` | 避免透明窗口闪出默认背景 |
| `hasShadow` | `false` | 不用 macOS 原生阴影，避免矩形边缘高光形成可见边框 |

入口文件需要确保 `html` / `body` / `#root` 都是透明背景：

```ts
document.documentElement.style.background = 'transparent'
document.body.style.background = 'transparent'
document.getElementById('root')!.style.background = 'transparent'
```

## CSS 阴影

窗口可见实体由 HTML/CSS 绘制：

```tsx
<div className="bg-background rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]">
  ...
</div>
```

CSS `box-shadow` 会画在元素边界外，因此窗口尺寸必须比内容大一圈：

```ts
export const SHADOW_INSET = 30

export const WINDOW_SIZE = {
  width: CONTENT_SIZE.width + SHADOW_INSET * 2,
  height: CONTENT_SIZE.height + SHADOW_INSET * 2,
}
```

```tsx
<div style={{ padding: SHADOW_INSET }}>
  <div className="rounded-2xl shadow-[...]">
    ...
  </div>
</div>
```

`SHADOW_INSET` 要覆盖阴影最大扩散范围。当前阴影远层是 `0 8px 24px`，扩散约 `32px`，取 `30px` 可以避免明显裁切

## 点击穿透

透明 padding、圆角外透明区和 CSS 阴影都仍属于原生 `BrowserWindow` 矩形区域。只写 `pointer-events: none` 不能让点击穿透到后方应用，因为它只影响 Chromium DOM 命中测试，不改变系统窗口命中

统一使用 `setIgnoreMouseEvents` 动态切换：

```ts
win.setIgnoreMouseEvents(true, { forward: true })
```

规则：

- 鼠标在可见实体内：`setIgnoreMouseEvents(false)`，窗口接收按钮、滚动、拖动等交互
- 鼠标在阴影、透明 padding、圆角外或两块 UI 中间 gap：`setIgnoreMouseEvents(true, { forward: true })`，点击落到后方窗口
- `{ forward: true }` 用来保证忽略点击时仍能收到 `mousemove`，否则无法判断鼠标何时重新进入实体区域

渲染层统一使用：

```tsx
import { getInsetWindowHitTestRegion, useRoundedWindowHitTest } from '../shared'

useRoundedWindowHitTest(WindowType.VOICE_IME, () => [
  getInsetWindowHitTestRegion(SHADOW_INSET, 16),
])
```

多块 UI 仍保持单个 `BrowserWindow`，只注册多个 hit-test 区域：

```tsx
useRoundedWindowHitTest(WindowType.FOCUS_NATIVE, [
  { x: 30, y: 30, width: 220, height: 44, radius: 22 },
  { x: 262, y: 30, width: 128, height: 44, radius: 22 },
])
```

这样中间视觉 gap 是同一个窗口内的透明区域，但命中测试会立刻穿透，后方元素可以点击；同时仍只保留一个 renderer、一个 React tree 和一套窗口生命周期

## 拖动

透明点击穿透窗口不要依赖 `-webkit-app-region: drag`。它会吞掉 drag 区域里的 DOM 事件，和按钮、hover、动态穿透都容易冲突

统一使用 `useWindowDrag` 手写拖动：

```tsx
const dragHandlers = useWindowDrag(WindowType.FOCUS_NATIVE)

return (
  <section
    {...dragHandlers}
    className="cursor-grab active:cursor-grabbing"
  >
    <button data-no-window-drag="true">关闭</button>
  </section>
)
```

需要排除拖动的按钮、输入框、链接等元素加：

```tsx
data-no-window-drag="true"
```

## 缩放

可缩放透明窗口使用 `<ResizeHandles>`。手柄对齐可见实体边缘，不依赖原生透明边框热区：

```tsx
<div className="relative h-screen w-screen" style={{ padding: SHADOW_INSET }}>
  <div className="h-full w-full rounded-2xl shadow-[...]">
    ...
  </div>

  <ResizeHandles
    windowType={WindowType.SHORTCUT_TEST}
    inset={SHADOW_INSET}
    minWidth={280 + SHADOW_INSET * 2}
    minHeight={180 + SHADOW_INSET * 2}
  />
</div>
```

可缩放窗口的 hit-test 必须额外保留 resize handle 热区，否则透明边缘穿透后手柄无法收到 pointer 事件：

```tsx
useRoundedWindowHitTest(WindowType.SHORTCUT_TEST, () => [
  getInsetWindowHitTestRegion(SHADOW_INSET, 16),
  ...getResizeHandleHitTestRegions(SHADOW_INSET),
])
```

## macOS 全屏 Space 上的辅助浮窗

主窗口进入 macOS 原生全屏后，Voice IME 这类辅助浮窗需要加入 fullscreen Space，否则可能被系统切到新的黑屏 Space

窗口配置使用 `macFullscreenAuxiliary`：

```ts
[WindowType.VOICE_IME]: {
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  focusable: false,
  hasShadow: false,
  macFullscreenAuxiliary: true,
}
```

窗口工厂在 macOS 下落地为 panel + fullscreen auxiliary：

```ts
if (macFullscreenAuxiliary && process.platform === 'darwin') {
  browserWindowOptions.type = 'panel'
}

window.setVisibleOnAllWorkspaces(true, {
  visibleOnFullScreen: true,
  skipTransformProcessType: true,
})
window.setFullScreenable(false)
```

验证方式：

1. 完整重启 Electron 主进程，窗口创建参数只在创建时生效
2. 点击主窗口绿灯进入 macOS 原生全屏
3. 触发 Voice IME
4. 预期：浮窗出现在同一个 fullscreen Space 内，不切到黑屏 Space

## 当前接入文件

| 文件 | 职责 |
|------|------|
| `renderer/windows/shared/useRoundedWindowHitTest.ts` | 圆角实体命中测试、动态点击穿透、resize handle 命中区域 |
| `renderer/windows/shared/useWindowDrag.ts` | 手写窗口拖动，支持 `data-no-window-drag` 排除交互元素 |
| `renderer/windows/shared/ResizeHandles.tsx` | 可缩放窗口的透明四角/四边手柄 |
| `renderer/windows/focus-native/FocusNativeApp.tsx` | 单窗口左右分离 UI，多区域 hit-test |
| `renderer/windows/voice-ime/VoiceImeApp.tsx` | 单实体浮窗 hit-test |
| `renderer/windows/meeting-toast/MeetingToastApp.tsx` | 动态尺寸 toast hit-test |
| `renderer/windows/shortcut-test/ShortcutTestApp.tsx` | hit-test + 手写拖动 + resize handles |
| `renderer/windows/selection/SelectionApp.tsx` | hit-test + 手写标题栏拖动 + resize handles |
| `ipc/services/window/{contract,client,service}.ts` | `setIgnoreMouseEvents`、`getBounds`、`setBounds` IPC |
| `shared/window-config/constants.ts` | 窗口透明、尺寸、shadow inset、持久化配置 |

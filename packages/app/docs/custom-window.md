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

## 核心文件

| 文件 | 职责 |
|------|------|
| `shared/window-config/constants.ts` | 窗口配置（transparent、backgroundColor、hasShadow） |
| `renderer/voice-ime.tsx` | 入口，JS 强制 html/body/root 透明 |
| `renderer/VoiceImeApp/constants.ts` | SHADOW_INSET、各形态尺寸定义 |
| `renderer/VoiceImeApp/VoiceImeApp.tsx` | motion.div 容器动画 + AnimatePresence 内容切换 |
| `main/window-manager.ts` | `resizeTo()` 方法，水平居中 + 底边锚定 |
| `ipc/services/window/` | resizeTo IPC handler + API |

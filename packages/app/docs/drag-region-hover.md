# Drag Region 与 Hover 交互的冲突与解法

## 问题

`-webkit-app-region: drag` 让区域可拖拽移动窗口，但同时**吞掉该区域的所有 DOM 鼠标事件**——`mouseenter`、`mouseleave`、`mousemove`、`click` 全部不触发

这意味着：在 drag 区域上做 hover 检测（如 hover 展开按钮），**标准 DOM 事件方案全部失效**

### 典型症状

```tsx
{/* 外层容器绑定 hover 事件 */}
<div
  onMouseEnter={() => setHovered(true)}
  onMouseLeave={() => setHovered(false)}
>
  {/* pill 是 drag 区域 */}
  <div className="[-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]">
    <button>⏸</button>         {/* no-drag：hover 正常 */}
    <span>00:42</span>          {/* 继承 drag：hover 失效 */}
    <div className="divider" /> {/* 继承 drag：hover 失效 */}
  </div>
</div>
```

当光标从 button（no-drag）移到 time text（drag），外层容器会收到 `mouseleave`，再移到另一个 button 又收到 `mouseenter`。导致 hover 状态**反复切换**、UI 疯狂闪烁

### 为什么增加 timeout 也不够

```tsx
// ❌ 100-300ms timeout 只能缓解，不能解决
const handleMouseLeave = () => {
  timer = setTimeout(() => setHovered(false), 300)
}
```

如果用户在 drag 区域停留超过 timeout 时间（比如看一下时间），hover 照样丢失。而 timeout 设太长（如 1s），鼠标真正离开时收起会明显迟钝

---

## 解法：全局 pointermove + 矩形碰撞检测

完全绕开元素级事件，在 `document` 上监听 `pointermove`，用 `getBoundingClientRect` 判断光标是否在目标区域内

### 为什么 pointermove 不受 drag 影响

`-webkit-app-region: drag` 拦截的是**元素级**的事件分发（mouseenter/leave/click）。但 `document` 级的 `pointermove` 仍然触发——Chromium 需要持续追踪光标位置用于渲染（cursor 样式、tooltip 等），这个事件不会被 drag region 拦截

### 实现

```ts
// useBarHover.ts
import { useEffect, useRef, useState } from 'react'

export function useBarHover<T extends HTMLElement>(margin = 8) {
  const ref = useRef<T>(null)
  const [isHovered, setIsHovered] = useState(false)
  const prevRef = useRef(false)

  useEffect(() => {
    let rafId: number

    const onPointerMove = (e: PointerEvent) => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const el = ref.current
        if (!el) return

        const { left, right, top, bottom } = el.getBoundingClientRect()
        const inside =
          e.clientX >= left - margin &&
          e.clientX <= right + margin &&
          e.clientY >= top - margin &&
          e.clientY <= bottom + margin

        if (inside !== prevRef.current) {
          prevRef.current = inside
          setIsHovered(inside)
        }
      })
    }

    document.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => {
      document.removeEventListener('pointermove', onPointerMove)
      cancelAnimationFrame(rafId)
    }
  }, [margin])

  return { ref, isHovered }
}
```

### 关键设计

| 要点 | 说明 |
|------|------|
| `document.pointermove` | 绕过 drag region 的事件拦截 |
| `requestAnimationFrame` | 节流：每帧最多一次 rect 计算 |
| `prevRef` 比对 | 只在状态真正变化时触发 `setState`，避免无效渲染 |
| `margin` 参数 | 额外容差（默认 8px），防止光标在边缘反复进出 |
| `{ passive: true }` | 告诉浏览器不会 `preventDefault`，不阻塞滚动 |

### 使用

```tsx
const { ref: barRef, isHovered } = useBarHover<HTMLDivElement>()

<div ref={barRef} className="[-webkit-app-region:drag]">
  {/* 无论光标在 drag 还是 no-drag 子区域，isHovered 都稳定 */}
</div>
```

### 性能

- 浮窗场景（如录音条、状态条）：窗口很小，listener 几乎零开销
- 主窗口场景（如底部录音栏）：只在组件挂载期间监听，录音结束后自动 cleanup

---

## 模式：Hover 展开右侧操作按钮

一个常见的浮窗 UI 模式——紧凑态只显示核心信息，hover 时右侧弹出操作按钮

### 结构

```
不 hover：  [●] 00:42 | ⏸ ⛶
hover 后：  [●] 00:42 | ⏸ ⛶   [⚑] [📷] [↗]
```

### 动画方案

三层动画协同，共用 spring 物理参数：

```tsx
const actionTransition = { type: 'spring', stiffness: 400, damping: 30 } as const
```

**第 1 层 — 按钮容器（宽度 + 透明度）：**

```tsx
<motion.div
  className="flex items-center gap-2.5 overflow-hidden"
  initial={false}
  animate={{
    width: isHovered ? 'auto' : 0,
    opacity: isHovered ? 1 : 0,
    marginLeft: isHovered ? 10 : 0,
  }}
  transition={actionTransition}
  style={{ pointerEvents: isHovered ? 'auto' : 'none' }}
>
```

| 属性 | 隐藏 → 显示 | 说明 |
|------|-------------|------|
| `width` | `0 → auto` | motion/react 支持动画到 `auto`，配合 `overflow-hidden` 做裁剪 |
| `opacity` | `0 → 1` | 渐显 |
| `marginLeft` | `0 → 10px` | 替代 `gap`（width: 0 时 gap 会产生空白） |
| `pointerEvents` | `none → auto` | 隐藏时不可交互，避免误触 |

**第 2 层 — 每个按钮（缩放 + 交错）：**

```tsx
<motion.button
  animate={{ scale: isHovered ? 1 : 0.5 }}
  transition={{ ...actionTransition, delay: isHovered ? index * 0.03 : 0 }}
>
```

每个按钮从 `scale: 0.5` 弹到 `1`，通过 `delay` 交错弹出（0.02s / 0.05s / 0.08s）。收起时无延迟，同时消失

**第 3 层（可选）— 卡片本身宽度变化：**

```tsx
<motion.div
  animate={{ width: isHovered ? expandedWidth : compactWidth }}
  transition={{ type: 'spring', stiffness: 400, damping: 35 }}
>
```

卡片背景跟着长，视觉上"整个控件在变宽"。damping 35（略高于按钮的 30）让卡片比按钮稍慢，产生"按钮迫不及待弹出"的层次感

---

## 技巧：利用 Shadow Inset 做免 IPC 宽度膨胀

### 原理

透明窗口的 `SHADOW_INSET`（30px）是给 CSS 阴影预留的透明空间。卡片在这个空间内伸缩，**不需要 IPC 改变窗口大小**

```
┌─────────────────── 窗口 320px ───────────────────┐
│ 30px │        卡片 160px        │    透明 130px    │ ← 不 hover
│ 30px │           卡片 260px            │  30px     │ ← hover 后
└──────────────────────────────────────────────────┘
```

卡片从 160→260 只是"吃掉"了右侧透明区域，窗口始终 320px 不变

### 何时需要 IPC resize

| 场景 | 是否需要 IPC |
|------|-------------|
| hover 展开按钮（同一 state 内） | **不需要**，在 shadow inset 空间内伸缩 |
| 状态切换（idle → focused，高度变化大） | **需要**，超出预留空间 |
| 视图模式切换（capsule → panel） | **需要**，尺寸变化量大 |

### 规划窗口尺寸的原则

```ts
// 窗口尺寸 = max(各状态内容宽度) + 2 × SHADOW_INSET
// 确保最大内容（含 hover 展开）不超过窗口
const WINDOW_SIZE = {
  idle: {
    width: Math.max(COMPACT_WIDTH, EXPANDED_WIDTH) + SHADOW_INSET * 2,
    height: CONTENT_HEIGHT + SHADOW_INSET * 2,
  },
}
```

---

## 排查清单

遇到 drag 区域的 hover 问题时，按此顺序检查：

| # | 检查项 | 说明 |
|---|--------|------|
| 1 | 是否有元素继承了 `drag` | `[&_button]` 只排除 `<button>`，`<span>`/`<div>` 仍继承 drag |
| 2 | 是否用了 `onMouseEnter/Leave` | drag 区域内不可靠，换 `useBarHover` |
| 3 | hover 展开后内容是否溢出窗口 | 超出窗口边界的部分不可见也不可交互 |
| 4 | `justify-center` 是否导致漂移 | 内容变宽时居中会左移，用 `justify-start` 或绝对定位避免 |
| 5 | 按钮能否点击 | 检查 `pointerEvents`、`z-index`、`-webkit-app-region` |

## 参考文件

| 文件 | 说明 |
|------|------|
| `renderer/components/RecordingBar/useBarHover.ts` | hover 检测 hook |
| `renderer/components/RecordingBar/RecordingBar.tsx` | hover 展开按钮的完整实现（flowtica 项目） |
| `renderer/windows/focus-demo/FocusDemoApp.tsx` | 卡片宽度膨胀 + 按钮展开示例 |
| `shared/window-config/constants.ts` | SHADOW_INSET 和窗口尺寸定义 |

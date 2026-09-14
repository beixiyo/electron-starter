import type { WindowInsets } from './types'

/** 四边皆 0 的可见内容留白：窗口边就是可见边 */
export const EMPTY_INSETS: WindowInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
}

/**
 * 透明窗口留给 CSS shadow 的单侧边距
 * 阴影远层 blur=24px + offset-y=8px，最远扩散 32px，取 30 作为安全值
 */
export const SHADOW_INSET = 30

/**
 * 按 {@link SHADOW_INSET} 画投影的透明浮窗，声明给主进程的四边留白
 *
 * 与 {@link SHADOW_INSET} 是同一段留白，只是换成 `visibleContentInsets` 的形状
 * 不声明它，主进程的边界收敛（`clampWindowBounds`）就只认窗口边：底部浮层为了
 * 让**可见内容**压到离底 {@link BOTTOM_FLOATING_CLEARANCE} 而下探的那段透明留白会被
 * 当成越界，第一次 `resizeTo` 就把窗口拽回工作区内，可见内容实际离底一个 inset
 */
export const SHADOW_WINDOW_INSETS = {
  top: SHADOW_INSET,
  right: SHADOW_INSET,
  bottom: SHADOW_INSET,
  left: SHADOW_INSET,
} as const

/**
 * 底部浮层「可见内容」底边与工作区底边的净空
 *
 * 只承担一点呼吸感，不再额外避让任务栏 / Dock：系统给出的 workArea 已经把常驻任务栏
 * 排除在外，再自留几十像素当避让等于重复扣了一次。任务栏自动隐藏时 workArea 下探到
 * 屏幕底，浮层跟着贴到底本值，语义仍然成立
 *
 * 本值量的是可见内容而非窗口边——浮窗四周还有一圈透明阴影留白
 * （{@link SHADOW_WINDOW_INSETS}），由位置计算按窗口自己的 `visibleContentInsets` 让回去
 */
export const BOTTOM_FLOATING_CLEARANCE = 8

/** 语音浮层的阴影留白，主进程落位与渲染层测量共用。 */
export const VOICE_IME_SHADOW_INSET = SHADOW_INSET

/**
 * 语音浮层的固定尺寸：结果卡内容 344 × 194 加四边留白，所有形态共用这一个窗
 *
 * 实测症状：胶囊切结果卡时先整体平移到卡片的左上角、停一下再放大，中途大小还闪
 * 根因是透明窗 `setBounds` 会先把**上一帧**按新原点画一次，再换成新尺寸的帧
 * （electron/electron#39834，macOS 与 Windows 都有，Electron 43 仍未修）：窗口居中、
 * 底边钉死，长大时原点必然往左上跑，旧帧跟着挪就是那次「平移」；只要可见期间
 * 变过尺寸这一帧就躲不掉，再叠一条原生 resize 动画便是用户看到的两段式
 *
 * 所以窗口从建出来就固定为最大的一档、可见期间永不 resize，形变全由渲染层的壳画
 * （壳锚在窗口底边正中，见 `VoiceImeShell`）。代价是主进程不能再拿窗口顶边当
 * 胶囊顶边——壳的度量由渲染层上报（`voiceIme.setShellMetrics`），见 `global-toast.ts`
 *
 * 各形态的内容尺寸都必须装得下：宽 ≤ 344、高 ≤ 194，超出的部分会被窗口边裁掉
 */
export const VOICE_IME_SIZE = {
  width: 344 + VOICE_IME_SHADOW_INSET * 2,
  height: 194 + VOICE_IME_SHADOW_INSET * 2,
} as const

/**
 * 语音胶囊的内容高度
 *
 * 主进程在渲染层上报壳高之前拿它兜底摆全局提示条；渲染层的胶囊形态也从这里取，
 * 两边不能各写一个 40
 */
export const VOICE_IME_CAPSULE_HEIGHT = 40

/** 全局提示窗口为自身视觉留白预留的单侧边距 */
export const GLOBAL_TOAST_SHADOW_INSET = 10

/** 全局提示窗口首次创建时的兜底内容尺寸，renderer 实测后会立即覆盖 */
export const GLOBAL_TOAST_CONTENT_SIZE = {
  width: 320,
  height: 40,
} as const

/** 全局提示初始窗口尺寸（内容 + 两侧留白） */
export const GLOBAL_TOAST_WINDOW_SIZE = {
  width: GLOBAL_TOAST_CONTENT_SIZE.width + GLOBAL_TOAST_SHADOW_INSET * 2,
  height: GLOBAL_TOAST_CONTENT_SIZE.height + GLOBAL_TOAST_SHADOW_INSET * 2,
} as const

/** 全局提示可见底边与 Voice IME 可见顶边的间距 */
export const GLOBAL_TOAST_GAP = 8

/** 屏幕相对定位时，全局提示可见边与工作区边缘的默认距离 */
export const GLOBAL_TOAST_EDGE_OFFSET = 96

/** 焦点浮窗左右实体卡片之间的真实点击穿透空隙 */
export const FOCUS_NATIVE_GAP = 12

/** 焦点浮窗 CSS 阴影单侧安全边距 */
export const FOCUS_NATIVE_SHADOW_INSET = 30

/** 焦点浮窗左侧信息内容尺寸 */
export const FOCUS_NATIVE_PANEL_CONTENT_SIZE = {
  idle: { width: 220, height: 44 },
  focused: { width: 280, height: 96 },
} as const

/** 焦点浮窗右侧动作内容尺寸 */
export const FOCUS_NATIVE_ACTIONS_CONTENT_SIZE = {
  idle: { width: 128, height: 44 },
  focused: { width: 128, height: 96 },
} as const

/** 焦点浮窗整体内容尺寸（不含 shadow inset） */
export const FOCUS_NATIVE_CONTENT_SIZE = {
  idle: {
    width: FOCUS_NATIVE_PANEL_CONTENT_SIZE.idle.width + FOCUS_NATIVE_GAP + FOCUS_NATIVE_ACTIONS_CONTENT_SIZE.idle.width,
    height: Math.max(FOCUS_NATIVE_PANEL_CONTENT_SIZE.idle.height, FOCUS_NATIVE_ACTIONS_CONTENT_SIZE.idle.height),
  },
  focused: {
    width: FOCUS_NATIVE_PANEL_CONTENT_SIZE.focused.width + FOCUS_NATIVE_GAP + FOCUS_NATIVE_ACTIONS_CONTENT_SIZE.focused.width,
    height: Math.max(FOCUS_NATIVE_PANEL_CONTENT_SIZE.focused.height, FOCUS_NATIVE_ACTIONS_CONTENT_SIZE.focused.height),
  },
} as const

/** 焦点浮窗整体窗口尺寸（内容 + shadow inset） */
export const FOCUS_NATIVE_WINDOW_SIZE = {
  idle: {
    width: FOCUS_NATIVE_CONTENT_SIZE.idle.width + FOCUS_NATIVE_SHADOW_INSET * 2,
    height: FOCUS_NATIVE_CONTENT_SIZE.idle.height + FOCUS_NATIVE_SHADOW_INSET * 2,
  },
  focused: {
    width: FOCUS_NATIVE_CONTENT_SIZE.focused.width + FOCUS_NATIVE_SHADOW_INSET * 2,
    height: FOCUS_NATIVE_CONTENT_SIZE.focused.height + FOCUS_NATIVE_SHADOW_INSET * 2,
  },
} as const

/** MEETING_TOAST 内容尺寸（不含 shadow inset） */
export const MEETING_TOAST_CONTENT_SIZE = {
  width: 340,
  height: 72,
} as const

/** MEETING_TOAST 窗口尺寸（内容 + 2×SHADOW_INSET） */
export const MEETING_TOAST_WINDOW_SIZE = {
  width: MEETING_TOAST_CONTENT_SIZE.width + SHADOW_INSET * 2,
  height: MEETING_TOAST_CONTENT_SIZE.height + SHADOW_INSET * 2,
} as const

/** MENUBAR 内容尺寸（不含 shadow inset） */
export const MENUBAR_CONTENT_SIZE = {
  width: 280,
  height: 160,
} as const

/** MENUBAR 窗口尺寸（内容 + 2×SHADOW_INSET） */
export const MENUBAR_WINDOW_SIZE = {
  width: MENUBAR_CONTENT_SIZE.width + SHADOW_INSET * 2,
  height: MENUBAR_CONTENT_SIZE.height + SHADOW_INSET * 2,
} as const

/** SHORTCUT_TEST 内容尺寸（不含 shadow inset） */
export const SHORTCUT_TEST_CONTENT_SIZE = {
  width: 500,
  height: 360,
} as const

/** SHORTCUT_TEST 窗口尺寸（内容 + 2×SHADOW_INSET） */
export const SHORTCUT_TEST_WINDOW_SIZE = {
  width: SHORTCUT_TEST_CONTENT_SIZE.width + SHADOW_INSET * 2,
  height: SHORTCUT_TEST_CONTENT_SIZE.height + SHADOW_INSET * 2,
} as const

/** 状态类浮窗池默认窗口尺寸 */
export const FLOATING_STATUS_POOL_WINDOW_SIZE = MEETING_TOAST_WINDOW_SIZE

/** 工具面板浮窗池默认窗口尺寸 */
export const UTILITY_PANEL_POOL_WINDOW_SIZE = {
  width: 500 + SHADOW_INSET * 2,
  height: 300 + SHADOW_INSET * 2,
  minWidth: 280 + SHADOW_INSET * 2,
  minHeight: 180 + SHADOW_INSET * 2,
} as const

/**
 * 权限拖拽引导卡片的可见内容尺寸
 *
 * 539x147：卡片要横跨系统设置内容区的宽度，读起来才像是「属于上面那个列表」
 * 做成接近正方形就会变回一个恰好停在旁边的对话框
 */
export const PERMISSION_DRAG_GUIDE_CONTENT_SIZE = {
  width: 539,
  height: 147,
} as const

/**
 * 卡片走原生 vibrancy 毛玻璃，圆角与投影都由系统画在窗口本身上，
 * 内容即窗口，四周不需要给 CSS 阴影留透明边。保留这个常量是为了让贴合计算的
 * 「可见内容」语义与其他透明浮窗一致
 */
export const PERMISSION_DRAG_GUIDE_SHADOW_INSET = 0

export const PERMISSION_DRAG_GUIDE_WINDOW_SIZE = {
  width: PERMISSION_DRAG_GUIDE_CONTENT_SIZE.width + PERMISSION_DRAG_GUIDE_SHADOW_INSET * 2,
  height: PERMISSION_DRAG_GUIDE_CONTENT_SIZE.height + PERMISSION_DRAG_GUIDE_SHADOW_INSET * 2,
} as const

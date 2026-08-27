/**
 * 透明窗口留给 CSS shadow 的单侧边距
 * 阴影远层 blur=24px + offset-y=8px，最远扩散 32px，取 30 作为安全值
 */
export const SHADOW_INSET = 30

/** VOICE_IME 各状态内容尺寸（不含 shadow inset） */
export const VOICE_IME_CONTENT_SIZE = {
  idle: { width: 280, height: 72 },
  recording: { width: 280, height: 144 },
  processing: { width: 280, height: 72 },
} as const

/** VOICE_IME 各状态窗口尺寸（内容 + 2×SHADOW_INSET） */
export const VOICE_IME_WINDOW_SIZE = {
  idle: { width: VOICE_IME_CONTENT_SIZE.idle.width + SHADOW_INSET * 2, height: VOICE_IME_CONTENT_SIZE.idle.height + SHADOW_INSET * 2 },
  recording: { width: VOICE_IME_CONTENT_SIZE.recording.width + SHADOW_INSET * 2, height: VOICE_IME_CONTENT_SIZE.recording.height + SHADOW_INSET * 2 },
  processing: { width: VOICE_IME_CONTENT_SIZE.processing.width + SHADOW_INSET * 2, height: VOICE_IME_CONTENT_SIZE.processing.height + SHADOW_INSET * 2 },
} as const

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

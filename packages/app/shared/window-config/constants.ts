import type { WindowConfig } from './types'
import { WindowType } from '../types/window'

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

/** @deprecated 使用 VOICE_IME_CONTENT_SIZE */
export const VOICE_IME_SIZE = {
  WIDTH: VOICE_IME_CONTENT_SIZE.idle.width,
  HEIGHT: VOICE_IME_CONTENT_SIZE.idle.height,
} as const

/** VOICE_IME 各状态窗口尺寸（内容 + 2×SHADOW_INSET） */
export const VOICE_IME_WINDOW_SIZE = {
  idle: { width: VOICE_IME_CONTENT_SIZE.idle.width + SHADOW_INSET * 2, height: VOICE_IME_CONTENT_SIZE.idle.height + SHADOW_INSET * 2 },
  recording: { width: VOICE_IME_CONTENT_SIZE.recording.width + SHADOW_INSET * 2, height: VOICE_IME_CONTENT_SIZE.recording.height + SHADOW_INSET * 2 },
  processing: { width: VOICE_IME_CONTENT_SIZE.processing.width + SHADOW_INSET * 2, height: VOICE_IME_CONTENT_SIZE.processing.height + SHADOW_INSET * 2 },
} as const

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
  idle: { width: FOCUS_NATIVE_CONTENT_SIZE.idle.width + FOCUS_NATIVE_SHADOW_INSET * 2, height: FOCUS_NATIVE_CONTENT_SIZE.idle.height + FOCUS_NATIVE_SHADOW_INSET * 2 },
  focused: { width: FOCUS_NATIVE_CONTENT_SIZE.focused.width + FOCUS_NATIVE_SHADOW_INSET * 2, height: FOCUS_NATIVE_CONTENT_SIZE.focused.height + FOCUS_NATIVE_SHADOW_INSET * 2 },
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

export const WINDOW_CONFIGS: Record<WindowType, WindowConfig> = {
  [WindowType.MAIN]: {
    width: 1440,
    height: 1080,
    position: 'center',
    title: 'Demo',
    frame: true,
    transparent: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    movable: true,
    focusable: true,
    hasShadow: false,
    htmlPath: 'index.html',
    autoHideMenuBar: true,
    show: false,
    openDevTools: false,
  },

  [WindowType.VOICE_IME]: {
    width: VOICE_IME_WINDOW_SIZE.idle.width,
    height: VOICE_IME_WINDOW_SIZE.idle.height,
    position: 'bottom-center',
    title: 'Voice IME',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    htmlPath: 'windows/voice-ime/index.html',
    show: false,
    macFullscreenAuxiliary: true,
    openDevTools: false,
  },

  [WindowType.OAUTH]: {
    width: 600,
    height: 750,
    position: 'center',
    title: 'OAuth Login',
    frame: true,
    transparent: false,
    /**
     * 必须为非模态：macOS 上「parent + modal」会被渲染成贴在主窗上的
     * sheet 面板，没有标题栏和红绿灯，用户无法关闭/最小化
     * 非模态独立窗口自带系统标题栏三键；OAuth 回调走 session 级
     * webRequest 拦截（main/oauth-interceptor.ts），与窗口形态无关
     */
    modal: false,
    alwaysOnTop: false,
    movable: true,
    focusable: true,
    show: true,
    initialUrl: 'about:blank',
    useAppPreload: false,
  },

  [WindowType.SELECTION]: {
    width: 500 + SHADOW_INSET * 2,
    height: 300 + SHADOW_INSET * 2,
    position: 'center',
    title: 'Selected Text',
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    movable: true,
    focusable: true,
    hasShadow: false,
    htmlPath: 'windows/selection/index.html',
    show: false,
    openDevTools: false,
    setAlwaysOnTopOnShow: true,
  },

  [WindowType.FOCUS_NATIVE]: {
    width: FOCUS_NATIVE_WINDOW_SIZE.idle.width,
    height: FOCUS_NATIVE_WINDOW_SIZE.idle.height,
    position: 'bottom-right',
    title: 'Focus Native',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    focusable: true,
    hasShadow: false,
    htmlPath: 'windows/focus-native/index.html',
    show: false,
    openDevTools: false,
  },

  [WindowType.SHORTCUT_TEST]: {
    width: 400 + SHADOW_INSET * 2,
    height: 240 + SHADOW_INSET * 2,
    minWidth: 280 + SHADOW_INSET * 2,
    minHeight: 180 + SHADOW_INSET * 2,
    position: 'center',
    title: 'Shortcut Test',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    focusable: true,
    hasShadow: false,
    htmlPath: 'windows/shortcut-test/index.html',
    show: false,
    openDevTools: false,
    persistBounds: true,
  },

  [WindowType.MENUBAR]: {
    width: MENUBAR_WINDOW_SIZE.width,
    height: MENUBAR_WINDOW_SIZE.height,
    position: 'center',
    title: 'MenuBar',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: true,
    hasShadow: false,
    htmlPath: 'windows/menubar/index.html',
    show: false,
    openDevTools: false,
  },

  [WindowType.MEETING_TOAST]: {
    width: MEETING_TOAST_WINDOW_SIZE.width,
    height: MEETING_TOAST_WINDOW_SIZE.height,
    position: 'top-right',
    title: 'Meeting Detected',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    htmlPath: 'windows/meeting-toast/index.html',
    show: false,
    openDevTools: false,
  },
}

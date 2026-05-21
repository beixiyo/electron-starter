import type { WindowConfig } from './types'
import { WindowType } from '../types/window'

/**
 * 透明窗口留给 CSS shadow 的单侧边距。
 * 阴影远层 blur=24px + offset-y=8px，最远扩散 32px，取 30 作为安全值。
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

/** FOCUS_DEMO 各状态内容尺寸（不含 shadow inset） */
export const FOCUS_DEMO_CONTENT_SIZE = {
  idle: { width: 260, height: 40 },
  focused: { width: 260, height: 120 },
} as const

/** FOCUS_DEMO 各状态窗口尺寸（内容 + 2×SHADOW_INSET） */
export const FOCUS_DEMO_WINDOW_SIZE = {
  idle: { width: 260 + SHADOW_INSET * 2, height: 40 + SHADOW_INSET * 2 },
  focused: { width: 260 + SHADOW_INSET * 2, height: 120 + SHADOW_INSET * 2 },
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
    hasShadow: true,
    htmlPath: 'index.html',
    autoHideMenuBar: true,
    show: true,
    openDevTools: true,
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
    htmlPath: 'voice-ime.html',
    show: false,
    openDevTools: true,
  },

  [WindowType.OAUTH]: {
    width: 600,
    height: 750,
    position: 'center',
    title: 'OAuth Login',
    frame: true,
    transparent: false,
    modal: true,
    alwaysOnTop: false,
    movable: true,
    focusable: true,
    show: true,
    initialUrl: 'about:blank',
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
    htmlPath: 'selection.html',
    show: false,
    openDevTools: false,
    setAlwaysOnTopOnShow: true,
  },

  [WindowType.FOCUS_DEMO]: {
    width: FOCUS_DEMO_WINDOW_SIZE.idle.width,
    height: FOCUS_DEMO_WINDOW_SIZE.idle.height,
    position: 'bottom-right',
    title: 'Focus Demo',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    focusable: true,
    hasShadow: false,
    htmlPath: 'focus-demo.html',
    show: false,
    openDevTools: false,
  },

  [WindowType.SHORTCUT_TEST]: {
    width: 400 + SHADOW_INSET * 2,
    height: 240 + SHADOW_INSET * 2,
    position: 'center',
    title: 'Shortcut Test',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    focusable: true,
    hasShadow: false,
    htmlPath: 'shortcut-test.html',
    show: false,
    openDevTools: false,
  },
}

import type { WindowConfig } from './types'
import { WindowType } from '../types/window'
import {
  FLOATING_STATUS_POOL_WINDOW_SIZE,
  MENUBAR_WINDOW_SIZE,
  UTILITY_PANEL_POOL_WINDOW_SIZE,
  VOICE_IME_WINDOW_SIZE,
} from './metrics'

/**
 * 真实 BrowserWindow 配置
 *
 * 这里故意只包含会被主进程实际创建的物理窗口。逻辑窗口
 * （selection / shortcut-test / focus-native / meeting-toast）只在 registry.ts
 * 中声明，避免绕过窗口池创建旧独立窗口
 */
export const PHYSICAL_WINDOW_CONFIGS = {
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

  [WindowType.FLOATING_STATUS_POOL]: {
    width: FLOATING_STATUS_POOL_WINDOW_SIZE.width,
    height: FLOATING_STATUS_POOL_WINDOW_SIZE.height,
    position: 'top-right',
    title: 'Floating Status Pool',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    htmlPath: 'windows/floating-status-pool/index.html',
    show: false,
    openDevTools: false,
  },

  [WindowType.UTILITY_PANEL_POOL]: {
    width: UTILITY_PANEL_POOL_WINDOW_SIZE.width,
    height: UTILITY_PANEL_POOL_WINDOW_SIZE.height,
    minWidth: UTILITY_PANEL_POOL_WINDOW_SIZE.minWidth,
    minHeight: UTILITY_PANEL_POOL_WINDOW_SIZE.minHeight,
    position: 'center',
    title: 'Utility Panel Pool',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    focusable: true,
    hasShadow: false,
    htmlPath: 'windows/utility-panel-pool/index.html',
    show: false,
    /**
     * 必须为非激活 panel：普通 focusable 窗口被点击会激活整个 App 并成为 key window，
     * 关闭（hide）时 AppKit 会把 key 移交给同 App 下一个可见窗口（main）并将其前置，
     * 导致「点浮窗叉叉 → main 被拉起」。panel 全程不激活 App，从根上避免该链路
     */
    macFullscreenAuxiliary: true,
    openDevTools: false,
  },
} as const satisfies Record<PhysicalWindowType, WindowConfig>

export type PhysicalWindowType
  = | WindowType.MAIN
    | WindowType.VOICE_IME
    | WindowType.OAUTH
    | WindowType.MENUBAR
    | WindowType.FLOATING_STATUS_POOL
    | WindowType.UTILITY_PANEL_POOL

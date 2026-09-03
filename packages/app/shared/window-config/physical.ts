import { WindowType } from '../types/window'
import {
  FLOATING_STATUS_POOL_WINDOW_SIZE,
  GLOBAL_TOAST_WINDOW_SIZE,
  MENUBAR_WINDOW_SIZE,
  PERMISSION_DRAG_GUIDE_WINDOW_SIZE,
  UTILITY_PANEL_POOL_WINDOW_SIZE,
  VOICE_IME_WINDOW_SIZE,
} from './metrics'
import type { WindowConfig } from './types'

/**
 * 真实 BrowserWindow 配置
 *
 * 这里故意只包含会被主进程实际创建的物理窗口。逻辑窗口
 * （selection / shortcut-test / focus-native / meeting-toast）只在 registry.ts
 * 中声明，避免绕过窗口池创建旧独立窗口
 */
export const PHYSICAL_WINDOW_CONFIGS = {
  [WindowType.MAIN]: {
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 680,
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

  [WindowType.GLOBAL_TOAST]: {
    width: GLOBAL_TOAST_WINDOW_SIZE.width,
    height: GLOBAL_TOAST_WINDOW_SIZE.height,
    /** 首次创建先放在底部；每次显示时会根据目标位置重新计算 bounds */
    position: 'bottom-center',
    title: 'Global Toast',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    htmlPath: 'windows/global-toast/index.html',
    show: false,
    macFullscreenAuxiliary: true,
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

  [WindowType.PERMISSION_DRAG_GUIDE]: {
    width: PERMISSION_DRAG_GUIDE_WINDOW_SIZE.width,
    height: PERMISSION_DRAG_GUIDE_WINDOW_SIZE.height,
    /** 建出来先落在底部居中；真实位置由 `main/permissions/drag-guide` 按系统设置窗口实时贴合 */
    position: 'bottom-center',
    title: 'Permission Drag Guide',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    /**
     * 卡片是毛玻璃，要透出的是**系统设置这个别的进程的窗口**
     * CSS 的 backdrop-filter 只能模糊本窗口自己的内容，做不到；
     * 只有原生 NSVisualEffectView 能采样屏幕上的其他窗口，这就是 vibrancy
     * popover 材质在浅色下是接近系统弹层的浅灰半透明底
     *
     * 代价：圆角由系统按 frameless 窗口的标准半径画（roundedCorners 默认开启），
     * 不能自定义；投影也改由系统画（hasShadow）
     */
    vibrancy: 'popover',
    /**
     * 必须固定为 active：默认的 followWindow 只在窗口处于激活态时渲染毛玻璃，
     * 非激活态 macOS 会把材质压成一块实色。本窗永远不可聚焦、永远 showInactive，
     * 不写这一条就永远看不到透明效果（实测卡片是一块实心浅灰）
     */
    visualEffectState: 'active',
    /**
     * `window-factory.ts` 对任意 `alwaysOnTop: true` 的窗口统一 `setAlwaysOnTop(true, 'floating')`，
     * 层级由此固定为 floating（3），配置里没有也不需要单独的层级字段
     *
     * floating 必须高于「系统设置」（普通层级 0），否则卡片会被它盖住——引导整个失去意义
     *
     * 不能用更高的 screen-saver（1000）：macOS 的拖拽图像窗口在 kCGDraggingWindowLevel（500），
     * 低于 screen-saver。本窗虽然只是拖拽**源**、不接收 drop，但按下瞬间光标仍在卡片范围内，
     * 跟手的图标会被卡片自己盖住，直到光标离开卡片才出现
     * 浮于全屏 App 之上由 macFullscreenAuxiliary 的 collectionBehavior 保证，与层级无关
     */
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    /**
     * 绝不可聚焦
     *
     * 卡片一旦抢走焦点，「系统设置」就不再是 key window，拖拽途中它的列表放置高亮会消失，
     * 用户等于对着一个看起来不接受拖放的窗口在拖。这一条与 showInactive() 是成对的，
     * 缺任何一半都会让手势本身失效，而不只是观感变差
     */
    focusable: false,
    /** vibrancy 给了窗口实体形状，系统投影据此成立；CSS 投影反而会在毛玻璃外侧留一圈脏边 */
    hasShadow: true,
    htmlPath: 'windows/permission-drag-guide/index.html',
    show: false,
    /** 用户可能在全屏 App 里操作系统设置；同时带来 canJoinAllSpaces，Stage Manager 下不会被收走 */
    macFullscreenAuxiliary: true,
    openDevTools: false,
  },
} as const satisfies Record<PhysicalWindowType, WindowConfig>

export type PhysicalWindowType =
  | WindowType.MAIN
  | WindowType.VOICE_IME
  | WindowType.OAUTH
  | WindowType.MENUBAR
  | WindowType.GLOBAL_TOAST
  | WindowType.FLOATING_STATUS_POOL
  | WindowType.UTILITY_PANEL_POOL
  | WindowType.PERMISSION_DRAG_GUIDE

import { isObj } from '@jl-org/tool'
import type { WindowBounds, WindowConfig, WindowDisplayTarget, WindowInsets, WindowMetadata, WindowPosition } from '@shared'
import { clampWindowBounds, PHYSICAL_WINDOW_CONFIGS, resolveAlwaysOnTopLevel, resolveVisibleContentInsets, WindowType } from '@shared'
import type { BrowserWindow } from 'electron'
import { screen } from 'electron'
import { waitForWindowReady } from '../window-readiness'
import { getSavedBounds, saveBounds } from './bounds-store'
import { clampWindowBoundsToDisplay, getDisplayOfWindow, moveWindowToBounds, resolveTargetDisplay } from './display-target'
import { calculateWindowPosition, createBrowserWindow } from './window-factory'

/**
 * 空闲销毁目标：仅「冷」窗口（MENUBAR / 会议浮窗池）
 * 二者所有展示路径均为懒建（create-if-missing），销毁后下次触发可完整重建；
 * VOICE_IME / SELECTION 等延迟敏感窗口保持常驻（内存审计 F2）
 */
const IDLE_DESTROY_WINDOW_TYPES: ReadonlySet<WindowType> = new Set([
  WindowType.MENUBAR,
  WindowType.FLOATING_STATUS_POOL,
  WindowType.GLOBAL_TOAST,
])

/** 隐藏后驻留超过该时长即销毁，释放常驻渲染进程 */
const IDLE_DESTROY_DELAY_MS = 20 * 60 * 1000

/** 页面加载异常或卡住时的展示兜底时长 */
const PRESENT_FALLBACK_MS = 3000

class WindowManager {
  private windows: Map<WindowType, BrowserWindow> = new Map()
  private metadata: Map<WindowType, WindowMetadata> = new Map()
  private idleDestroyTimers: Map<WindowType, ReturnType<typeof setTimeout>> = new Map()
  /** 正在等待首屏加载的展示，按窗口实例保存以避免旧窗口回调影响新窗口 */
  private pendingPresent: Map<WindowType, PendingPresentation> = new Map()
  /** 按窗口类型登记的可见性订阅者 */
  private visibilityListeners: Map<WindowType, Set<WindowVisibilityListener>> = new Map()

  create(type: WindowType, configOverride?: Partial<WindowConfig>, parent?: BrowserWindow): BrowserWindow | null {
    this.clearIdleDestroy(type)

    const existingWindow = this.windows.get(type)
    if (existingWindow && !existingWindow.isDestroyed()) {
      if (configOverride?.initialUrl) {
        existingWindow.loadURL(configOverride.initialUrl)
      }
      existingWindow.focus()
      return existingWindow
    }

    const CONFIG = PHYSICAL_WINDOW_CONFIGS[type]
    if (!CONFIG) {
      return null
    }

    const config: WindowConfig = {
      ...CONFIG,
      ...configOverride,
    }

    /** 持久化窗口：用上次保存的 bounds 回填（已做屏幕内裁剪） */
    if (config.persistBounds) {
      const saved = getSavedBounds(type)
      if (saved) {
        const clamped = this.clampToScreen(saved, resolveVisibleContentInsets(config))
        config.width = clamped.width
        config.height = clamped.height
        config.position = { x: clamped.x, y: clamped.y }
      }
    }

    const resolvedParent = parent ?? this.getDefaultParent(type)
    const window = createBrowserWindow(config, resolvedParent, type)

    /** 持久化窗口：resize / move 落盘（saveBounds 内部已防抖） */
    if (config.persistBounds) {
      const persist = (): void => {
        if (!window.isDestroyed()) saveBounds(type, window.getBounds())
      }
      window.on('resize', persist)
      window.on('move', persist)
    }

    if (config.openDevTools) {
      window.webContents.openDevTools(
        isObj(config.openDevTools)
          ? config.openDevTools
          : undefined,
      )
    }

    this.windows.set(type, window)
    this.metadata.set(type, { type, config, createdAt: Date.now() })

    window.on('show', () => this.emitVisibility(type, true))
    window.on('hide', () => this.emitVisibility(type, false))
    window.on('closed', () => {
      this.cancelPendingPresent(type, window)
      /** 身份校验：destroy 后立即 create 同类型窗口时，旧窗口延迟触发的 closed 不能误删新窗口的槽位 */
      if (this.windows.get(type) === window) {
        this.windows.delete(type)
        this.metadata.delete(type)
        this.clearIdleDestroy(type)
        this.emitVisibility(type, false)
      }
    })

    return window
  }

  private getDefaultParent(type: WindowType): BrowserWindow | undefined {
    switch (type) {
      case WindowType.OAUTH:
        return this.get(WindowType.MAIN)
      default:
        return undefined
    }
  }

  get(type: WindowType): BrowserWindow | undefined {
    return this.windows.get(type)
  }

  /**
   * 订阅某类窗口的显示、隐藏和销毁事件；订阅时不回放当前状态
   *
   * 监听 BrowserWindow 自身事件可以覆盖绕过本管理器的 `showInactive()` 调用，
   * 也能让同类型窗口销毁后重建时继续使用原订阅
   */
  onVisibilityChange(type: WindowType, listener: WindowVisibilityListener): () => void {
    let listeners = this.visibilityListeners.get(type)
    if (!listeners) {
      listeners = new Set()
      this.visibilityListeners.set(type, listeners)
    }
    listeners.add(listener)

    return () => {
      listeners?.delete(listener)
    }
  }

  private emitVisibility(type: WindowType, visible: boolean): void {
    const listeners = this.visibilityListeners.get(type)
    if (!listeners) return

    for (const listener of listeners) listener(visible)
  }

  /**
   * 展示窗口；第二个参数接受旧版布尔值与 options 对象
   *
   * `presentWhenLoaded` 默认开启，避免懒建透明窗口在首屏完成前露出空白层；
   * `hide` / `destroy` 会撤销尚未执行的展示
   */
  show(type: WindowType, optionsOrAutoFocus: boolean | WindowShowOptions = {}): boolean {
    const window = this.windows.get(type)
    if (!window) {
      return false
    }

    this.cancelPendingPresent(type)

    const options = typeof optionsOrAutoFocus === 'boolean'
      ? { autoFocus: optionsOrAutoFocus }
      : optionsOrAutoFocus
    const {
      autoFocus = true,
      reposition,
      presentWhenLoaded = true,
    } = options

    this.clearIdleDestroy(type)

    const meta = this.metadata.get(type)
    if (meta?.config.setAlwaysOnTopOnShow) {
      window.setAlwaysOnTop(true, resolveAlwaysOnTopLevel(meta.config))
    }

    this.restoreIfMinimized(window)

    const shouldReposition = reposition ?? meta?.config.repositionOnShow
    if (shouldReposition) {
      this.applyPresetBounds(window, meta?.config)
    }

    const present = (): void => {
      if (!autoFocus) {
        window.showInactive()
        return
      }

      if (window.isVisible()) {
        window.focus()
        return
      }

      window.show()
      window.focus()
    }

    if (presentWhenLoaded) {
      this.presentWhenLoaded(type, window, present)
    }
    else {
      present()
    }

    return true
  }

  showInactive(type: WindowType, options: Omit<WindowShowOptions, 'autoFocus'> = {}): boolean {
    return this.show(type, { ...options, autoFocus: false })
  }

  hide(type: WindowType): boolean {
    this.cancelPendingPresent(type)

    const window = this.windows.get(type)
    if (!window) {
      return false
    }

    const meta = this.metadata.get(type)
    if (meta?.config.setAlwaysOnTopOnShow) {
      window.setAlwaysOnTop(false)
    }

    window.hide()
    this.scheduleIdleDestroy(type)
    return true
  }

  toggle(type: WindowType): boolean {
    const window = this.windows.get(type)
    if (!window) {
      return false
    }

    if (window.isVisible()) {
      this.hide(type)
      return false
    }
    else {
      this.show(type)
      return true
    }
  }

  destroy(type: WindowType): boolean {
    this.clearIdleDestroy(type)
    this.cancelPendingPresent(type)

    const window = this.windows.get(type)
    if (!window) {
      return false
    }

    window.destroy()
    return true
  }

  close(type: WindowType): boolean {
    const window = this.windows.get(type)
    if (!window || window.isDestroyed()) {
      return false
    }

    window.close()
    return true
  }

  minimize(type: WindowType): boolean {
    const window = this.windows.get(type)
    if (!window || window.isDestroyed()) {
      return false
    }

    window.minimize()
    return true
  }

  toggleFullScreen(type: WindowType): boolean {
    const window = this.windows.get(type)
    if (!window || window.isDestroyed()) {
      return false
    }

    window.setFullScreen(!window.isFullScreen())
    return true
  }

  /** 等待窗口完成当前文档加载；窗口关闭、加载失败或超时均返回 false */
  whenReady(type: WindowType, options: WindowReadyOptions = {}): Promise<boolean> {
    const window = this.windows.get(type)
    if (!window || window.isDestroyed()) {
      return Promise.resolve(false)
    }

    return waitForWindowReady(window, options)
  }

  isVisible(type: WindowType): boolean {
    const window = this.windows.get(type)
    return window !== undefined && window.isVisible()
  }

  exists(type: WindowType): boolean {
    return this.windows.has(type)
  }

  getMetadata(type: WindowType): WindowMetadata | undefined {
    return this.metadata.get(type)
  }

  getAllTypes(): WindowType[] {
    return Array.from(this.windows.keys())
  }

  getAll(): ReadonlyMap<WindowType, BrowserWindow> {
    return this.windows
  }

  destroyAll(): void {
    for (const timer of this.idleDestroyTimers.values()) {
      clearTimeout(timer)
    }
    this.idleDestroyTimers.clear()

    for (const [type] of this.windows) {
      this.destroy(type)
    }
  }

  getMainWindow(): BrowserWindow | undefined {
    return this.get(WindowType.MAIN)
  }

  /**
   * 调整窗口尺寸并按锚点重定位：
   * - `top-right` 窗口（如 RECORDING）：固定右上角，仅向左下伸缩，保持原位（避免居中重算导致窗口跳动）
   * - 其它窗口：水平居中、底边锚定（向上扩展）
   *
   * 落定前统一按窗口自己的可见内容留白收敛，与创建时的位置计算同源：
   * 只认窗口边的话，底部浮层为压低可见内容而下探的那段透明留白会被判成越界，
   * 第一次 resize 就把它拽回工作区内
   *
   * animate 仅在 macOS 有原生过渡效果
   */
  resizeTo(type: WindowType, width: number, height: number, animate = false): boolean {
    const win = this.windows.get(type)
    if (!win || win.isDestroyed()) return false

    const current = win.getBounds()
    const config = this.metadata.get(type)?.config
    const display = screen.getDisplayNearestPoint({
      x: current.x + current.width / 2,
      y: current.y + current.height / 2,
    })

    let nextBounds: WindowBounds
    if (config?.position === 'top-right') {
      /** 右上角锚点：右边与上边固定，仅向左下伸缩 */
      nextBounds = {
        x: current.x + current.width - width,
        y: current.y,
        width,
        height,
      }
    }
    else {
      const workArea = display.workArea
      nextBounds = {
        x: Math.round(workArea.x + (workArea.width - width) / 2),
        y: current.y + current.height - height,
        width,
        height,
      }
    }

    const insets = config
      ? resolveVisibleContentInsets(config)
      : undefined
    win.setBounds(clampWindowBoundsToDisplay(nextBounds, display, insets), animate)
    return true
  }

  /**
   * 直接设置窗口 bounds（支持部分字段，缺省沿用当前值）
   * 用于渲染层自绘四角/四边拖拽缩放，高频调用故默认不开动画
   * 尺寸下限由窗口自身 minWidth/minHeight 约束（Electron 原生裁剪）
   */
  setBounds(type: WindowType, bounds: Partial<WindowBounds>, animate = false): boolean {
    const win = this.windows.get(type)
    if (!win || win.isDestroyed()) return false

    win.setBounds({ ...win.getBounds(), ...bounds }, animate)
    return true
  }

  getBounds(type: WindowType): WindowBounds | null {
    const win = this.windows.get(type)
    if (!win || win.isDestroyed()) return null

    return win.getBounds()
  }

  /** 按指定预设位重新定位窗口，并使用窗口配置的目标屏 */
  moveToPreset(type: WindowType, position: WindowPosition): boolean {
    const window = this.windows.get(type)
    if (!window || window.isDestroyed()) {
      return false
    }

    const config = this.metadata.get(type)?.config
    const { width, height } = window.getBounds()
    const display = resolveTargetDisplay(config?.targetDisplay, { exclude: window })
    const { x, y } = calculateWindowPosition({
      position,
      width,
      height,
      visibleContentInsets: config
        ? resolveVisibleContentInsets(config)
        : undefined,
      display,
    })

    moveWindowToBounds(
      window,
      clampWindowBoundsToDisplay(
        { x, y, width, height },
        display,
        config
          ? resolveVisibleContentInsets(config)
          : undefined,
      ),
    )
    return true
  }

  /** 按配置的目标屏重新落位；传入 target 时只覆盖本次目标屏 */
  moveToDisplay(type: WindowType, target?: WindowDisplayTarget): boolean {
    const window = this.windows.get(type)
    if (!window || window.isDestroyed()) {
      return false
    }

    this.moveToTargetDisplay(window, this.metadata.get(type)?.config, target)
    return true
  }

  /**
   * 把保存的 bounds 收敛进最近的显示器工作区，避免还原到屏幕外
   *
   * 尺寸先夹进工作区，位置再交给 `clampWindowBounds`——后者只保证「可见内容」留在
   * 工作区里，透明窗四周那圈投影留白允许越过屏幕边缘
   */
  private clampToScreen(bounds: WindowBounds, insets?: Partial<WindowInsets>): WindowBounds {
    const display = screen.getDisplayNearestPoint({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    })
    const area = display.workArea

    return clampWindowBounds(
      {
        ...bounds,
        width: Math.min(bounds.width, area.width),
        height: Math.min(bounds.height, area.height),
      },
      area,
      insets,
    )
  }

  /** 把窗口按配置的目标屏和预设位落定，不判断窗口当前是否已经在目标屏 */
  private applyPresetBounds(window: BrowserWindow, config?: WindowConfig, target?: WindowDisplayTarget): void {
    const display = resolveTargetDisplay(target ?? config?.targetDisplay, { exclude: window })
    const { width, height } = window.getBounds()
    const { x, y } = calculateWindowPosition({
      position: config?.position,
      width,
      height,
      visibleContentInsets: config
        ? resolveVisibleContentInsets(config)
        : undefined,
      display,
    })

    moveWindowToBounds(
      window,
      clampWindowBoundsToDisplay(
        { x, y, width, height },
        display,
        config
          ? resolveVisibleContentInsets(config)
          : undefined,
      ),
    )
  }

  /** 仅在目标屏变化时搬家，避免覆盖用户自行摆放的窗口位置 */
  private moveToTargetDisplay(window: BrowserWindow, config?: WindowConfig, target?: WindowDisplayTarget): void {
    const display = resolveTargetDisplay(target ?? config?.targetDisplay, { exclude: window })
    if (getDisplayOfWindow(window).id === display.id) return

    this.applyPresetBounds(window, config, target)
  }

  /** 首屏未加载完时推迟展示，超时则兜底展示；调用方可通过 hide / destroy 撤销 */
  private presentWhenLoaded(type: WindowType, window: BrowserWindow, present: () => void): void {
    this.cancelPendingPresent(type)

    if (!window.webContents.isLoading()) {
      present()
      return
    }

    let pending: PendingPresentation
    const presentOnce = (): void => {
      if (this.pendingPresent.get(type) !== pending) return

      this.pendingPresent.delete(type)
      clearTimeout(pending.timer)
      if (!window.webContents.isDestroyed()) {
        window.webContents.off('did-finish-load', presentOnce)
      }

      if (!window.isDestroyed() && this.windows.get(type) === window) {
        present()
      }
    }

    pending = {
      window,
      timer: setTimeout(presentOnce, PRESENT_FALLBACK_MS),
      onFinish: presentOnce,
    }
    this.pendingPresent.set(type, pending)
    window.webContents.once('did-finish-load', presentOnce)
  }

  private cancelPendingPresent(type: WindowType, window?: BrowserWindow): void {
    const pending = this.pendingPresent.get(type)
    if (!pending || (window && pending.window !== window)) return

    clearTimeout(pending.timer)
    if (!pending.window.webContents.isDestroyed()) {
      pending.window.webContents.off('did-finish-load', pending.onFinish)
    }
    this.pendingPresent.delete(type)
  }

  private restoreIfMinimized(window: BrowserWindow): void {
    if (window.isMinimized()) {
      window.restore()
    }
  }

  /**
   * 冷窗口隐藏后启动空闲销毁计时：到点仍存在且不可见才销毁
   * 任何 show / create 路径都会清掉计时，重新展示走懒建重建
   */
  private scheduleIdleDestroy(type: WindowType): void {
    if (!IDLE_DESTROY_WINDOW_TYPES.has(type)) {
      return
    }

    this.clearIdleDestroy(type)

    const timer = setTimeout(() => {
      this.idleDestroyTimers.delete(type)

      const window = this.windows.get(type)
      if (!window || window.isDestroyed() || window.isVisible()) {
        return
      }

      window.destroy()
    }, IDLE_DESTROY_DELAY_MS)

    this.idleDestroyTimers.set(type, timer)
  }

  private clearIdleDestroy(type: WindowType): void {
    const timer = this.idleDestroyTimers.get(type)
    if (!timer) {
      return
    }

    clearTimeout(timer)
    this.idleDestroyTimers.delete(type)
  }
}

export const windowManager = new WindowManager()

/** 窗口可见性订阅回调；visible 为 false 也涵盖窗口被销毁 */
export type WindowVisibilityListener = (visible: boolean) => void

/** 展示窗口的参数 */
export type WindowShowOptions = {
  /** 展示时是否抢焦点 @default true */
  autoFocus?: boolean
  /** 本次展示是否按目标屏重新落位；缺省使用窗口配置 */
  reposition?: boolean
  /** 首屏加载中是否等 did-finish-load 后再展示 @default true */
  presentWhenLoaded?: boolean
}

/** 等待窗口加载完成的参数 */
export type WindowReadyOptions = {
  /** 最长等待时间，单位毫秒 @default 5000 */
  timeoutMs?: number
}

type PendingPresentation = {
  window: BrowserWindow
  timer: ReturnType<typeof setTimeout>
  onFinish: () => void
}

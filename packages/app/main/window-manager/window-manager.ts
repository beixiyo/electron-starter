import type { WindowBounds, WindowConfig, WindowMetadata } from '@shared'
import type { BrowserWindow } from 'electron'
import { isObj } from '@jl-org/tool'
import { PHYSICAL_WINDOW_CONFIGS, WindowType } from '@shared'
import { screen } from 'electron'
import { getSavedBounds, saveBounds } from './bounds-store'
import { createBrowserWindow } from './window-factory'

class WindowManager {
  private windows: Map<WindowType, BrowserWindow> = new Map()
  private metadata: Map<WindowType, WindowMetadata> = new Map()

  create(type: WindowType, configOverride?: Partial<WindowConfig>, parent?: BrowserWindow): BrowserWindow | null {
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
        const clamped = this.clampToScreen(saved)
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
        if (!window.isDestroyed())
          saveBounds(type, window.getBounds())
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

    window.on('closed', () => {
      /** 身份校验：destroy 后立即 create 同类型窗口时，旧窗口延迟触发的 closed 不能误删新窗口的槽位 */
      if (this.windows.get(type) === window) {
        this.windows.delete(type)
        this.metadata.delete(type)
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

  // show 时动态设置置顶，hide 时取消——覆盖了构造时的 alwaysOnTop 配置
  show(type: WindowType, autoFocus = true): boolean {
    const window = this.windows.get(type)
    if (!window) {
      return false
    }

    const meta = this.metadata.get(type)
    if (meta?.config.setAlwaysOnTopOnShow) {
      window.setAlwaysOnTop(true)
    }

    this.restoreIfMinimized(window)

    if (!autoFocus) {
      window.showInactive()
      return true
    }

    if (window.isVisible()) {
      window.focus()
    }
    else {
      window.show()
      window.focus()
    }
    return true
  }

  showInactive(type: WindowType): boolean {
    const window = this.windows.get(type)
    if (!window) {
      return false
    }

    const meta = this.metadata.get(type)
    if (meta?.config.setAlwaysOnTopOnShow) {
      window.setAlwaysOnTop(true)
    }

    this.restoreIfMinimized(window)
    window.showInactive()
    return true
  }

  hide(type: WindowType): boolean {
    const window = this.windows.get(type)
    if (!window) {
      return false
    }

    const meta = this.metadata.get(type)
    if (meta?.config.setAlwaysOnTopOnShow) {
      window.setAlwaysOnTop(false)
    }

    window.hide()
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
    const window = this.windows.get(type)
    if (!window) {
      return false
    }

    window.destroy()
    return true
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
   * animate 仅在 macOS 有原生过渡效果
   */
  resizeTo(type: WindowType, width: number, height: number, animate = false): boolean {
    const win = this.windows.get(type)
    if (!win || win.isDestroyed())
      return false

    const current = win.getBounds()
    const position = this.metadata.get(type)?.config.position

    let x: number
    let y: number
    if (position === 'top-right') {
      /** 右上角锚点：右边与上边固定，仅向左下伸缩 */
      x = current.x + current.width - width
      y = current.y
    }
    else {
      const display = screen.getDisplayNearestPoint({
        x: current.x + current.width / 2,
        y: current.y + current.height / 2,
      })
      const workArea = display.workArea
      x = Math.round(workArea.x + (workArea.width - width) / 2)
      y = current.y + current.height - height
    }

    win.setBounds({ x, y, width, height }, animate)
    return true
  }

  /**
   * 直接设置窗口 bounds（支持部分字段，缺省沿用当前值）
   * 用于渲染层自绘四角/四边拖拽缩放，高频调用故默认不开动画
   * 尺寸下限由窗口自身 minWidth/minHeight 约束（Electron 原生裁剪）
   */
  setBounds(type: WindowType, bounds: Partial<WindowBounds>, animate = false): boolean {
    const win = this.windows.get(type)
    if (!win || win.isDestroyed())
      return false

    win.setBounds({ ...win.getBounds(), ...bounds }, animate)
    return true
  }

  getBounds(type: WindowType): WindowBounds | null {
    const win = this.windows.get(type)
    if (!win || win.isDestroyed())
      return null

    return win.getBounds()
  }

  /** 把保存的 bounds 裁剪进最近的显示器工作区，避免还原到屏幕外 */
  private clampToScreen(bounds: WindowBounds): WindowBounds {
    const display = screen.getDisplayNearestPoint({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    })
    const area = display.workArea

    const width = Math.min(bounds.width, area.width)
    const height = Math.min(bounds.height, area.height)
    const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)
    const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)

    return { x, y, width, height }
  }

  private restoreIfMinimized(window: BrowserWindow): void {
    if (window.isMinimized()) {
      window.restore()
    }
  }
}

export const windowManager = new WindowManager()

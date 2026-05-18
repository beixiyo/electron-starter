import type { WindowConfig, WindowMetadata } from '@shared'
import type { BrowserWindow } from 'electron'
import { isObj } from '@jl-org/tool'
import { WINDOW_CONFIGS, WindowType } from '@shared'
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

    const CONFIG = WINDOW_CONFIGS[type]
    if (!CONFIG) {
      return null
    }

    const config: WindowConfig = {
      ...CONFIG,
      ...configOverride,
    }

    const resolvedParent = parent ?? this.getDefaultParent(type)
    const window = createBrowserWindow(config, resolvedParent)

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
      this.windows.delete(type)
      this.metadata.delete(type)
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

    if (window.isVisible() && autoFocus) {
      window.focus()
    }
    else {
      window.show()
      autoFocus && window.focus()
    }
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
}

export const windowManager = new WindowManager()

import type { SelectionHookConstructor, SelectionHookInstance, TextSelectionData } from 'selection-hook'
import { windowManager } from '@main/window-manager'
import { SELECTION_RENDERER_CHANNEL, WindowType } from '@shared'
import { screen, shell, systemPreferences } from 'electron'
import { isPureNum } from '@jl-org/tool'

/**
 * Selection Hook 管理器
 * 用于监听全局文本选择事件
 */
class SelectionManager {
  private selectionHook: SelectionHookInstance | null = null
  private isStarted = false

  /**
   * 初始化 Selection Hook
   */
  async init(): Promise<void> {
    // macOS 需要检查辅助功能权限
    if (process.platform === 'darwin') {
      const isTrusted = systemPreferences.isTrustedAccessibilityClient(false)
      if (!isTrusted) {
        console.warn('需要辅助功能权限才能使用 selection-hook')
        console.log('请按以下步骤授予权限：')
        console.log('1. 系统设置 → 隐私与安全性 → 辅助功能')
        console.log('2. 找到并勾选你的应用（Electron 或开发时的 Node.js）')
        console.log('3. 重新启动应用')

        /** 尝试打开系统偏好设置（辅助功能页面） */
        try {
          shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
          console.log('已尝试打开系统偏好设置')
        }
        catch (error) {
          console.error('打开系统偏好设置失败:', error)
        }

        return
      }
    }

    /** 导入 SelectionHook（CommonJS 方式） */
    const SelectionHook: SelectionHookConstructor = require('selection-hook')

    /** 创建实例（使用单例模式避免资源消耗） */
    this.selectionHook = new SelectionHook()

    /** 监听文本选择事件 */
    this.selectionHook.on('text-selection', (data) => {
      console.log('选中的文本:', data.text)
      console.log('来源应用:', data.programName)
      console.log('选择方法:', data.method)

      /** 如果选中了文本，显示选中文本窗口 */
      if (data.text && data.text.trim()) {
        /** 直接使用 windowManager 在主进程中处理，传递完整的 data 对象 */
        this.handleTextSelection(data)
      }
    })

    /** 开始监控（使用默认配置） */
    const started = this.selectionHook.start()
    if (started) {
      this.isStarted = true
      console.log('selection-hook 已启动')
    }
    else {
      console.error('selection-hook 启动失败')
    }

    /** 应用退出时清理资源 */
    process.on('exit', () => {
      this.cleanup()
    })
  }

  /**
   * 处理文本选择事件
   */
  private handleTextSelection(data: TextSelectionData): void {
    try {
      /** 获取鼠标位置（优先使用 selection-hook 提供的位置，否则使用 Electron API） */
      const mousePosition = this.getMousePosition(data)

      /** 使用 windowManager 直接创建和显示窗口 */
      const window = windowManager.create(WindowType.SELECTION)
      if (!window || window.isDestroyed()) {
        return
      }

      /** 如果获取到了鼠标位置，设置窗口位置 */
      if (mousePosition) {
        this.positionWindowNearMouse(window, mousePosition)
      }

      /** 等待窗口加载完成后再发送数据，避免窗口空白 */
      const sendData = () => {
        if (window.isDestroyed()) {
          return
        }
        /** 发送完整的数据对象到渲染进程（包含鼠标位置） */
        const selectionData = {
          text: data.text,
          programName: data.programName,
          method: data.method,
          mousePosStart: data.mousePosStart,
          mousePosEnd: data.mousePosEnd,
        }
        window.webContents.send(SELECTION_RENDERER_CHANNEL.DATA, selectionData)
      }

      /** 如果窗口已经加载完成，直接发送 */
      if (window.webContents.isLoading()) {
        window.webContents.once('did-finish-load', sendData)
      }
      else {
        sendData()
      }

      windowManager.show(WindowType.SELECTION)
      window.focus()
    }
    catch (error) {
      console.error('处理文本选择失败:', error)
    }
  }

  /**
   * 获取鼠标位置
   * 优先使用 selection-hook 提供的位置，否则使用 Electron API
   */
  private getMousePosition(data: TextSelectionData): { x: number, y: number } | null {
    /** 优先使用 selection-hook 提供的鼠标位置（选择结束时的位置） */
    const mousePosEnd = data.mousePosEnd
    if (mousePosEnd && isPureNum(mousePosEnd.x) && isPureNum(mousePosEnd.y)) {
      return { x: +mousePosEnd.x, y: +mousePosEnd.y }
    }

    /** 备选：使用选择开始时的位置 */
    const mousePosStart = data.mousePosStart
    if (mousePosStart && isPureNum(mousePosStart.x) && isPureNum(mousePosStart.y)) {
      return { x: +mousePosStart.x, y: +mousePosStart.y }
    }

    /** 最后备选：使用 Electron API 获取当前鼠标位置 */
    try {
      const point = screen.getCursorScreenPoint()
      return { x: point.x, y: point.y }
    }
    catch (error) {
      console.warn('无法获取鼠标位置:', error)
      return null
    }
  }

  /**
   * 将窗口定位到鼠标位置附近
   */
  private positionWindowNearMouse(window: Electron.BrowserWindow, mousePos: { x: number, y: number }): void {
    try {
      const [width, height] = window.getSize()
      const displays = screen.getAllDisplays()

      /** 找到鼠标所在的显示器 */
      const display = displays.find((d) => {
        const bounds = d.bounds
        return mousePos.x >= bounds.x
          && mousePos.x < bounds.x + bounds.width
          && mousePos.y >= bounds.y
          && mousePos.y < bounds.y + bounds.height
      }) || screen.getPrimaryDisplay()

      const { x: displayX, y: displayY, width: displayWidth, height: displayHeight } = display.workArea

      /** 计算窗口位置：鼠标位置向右下方偏移，确保窗口在屏幕内 */
      const offsetX = 20 // 鼠标右侧偏移
      const offsetY = 20 // 鼠标下方偏移

      let windowX = mousePos.x + offsetX
      let windowY = mousePos.y + offsetY

      /** 确保窗口不会超出屏幕边界 */
      const maxX = displayX + displayWidth - width
      const maxY = displayY + displayHeight - height

      windowX = Math.max(displayX, Math.min(windowX, maxX))
      windowY = Math.max(displayY, Math.min(windowY, maxY))

      /** 如果右侧空间不足，尝试放在鼠标左侧 */
      if (windowX + width > displayX + displayWidth) {
        windowX = mousePos.x - width - offsetX
        windowX = Math.max(displayX, windowX)
      }

      /** 如果下方空间不足，尝试放在鼠标上方 */
      if (windowY + height > displayY + displayHeight) {
        windowY = mousePos.y - height - offsetY
        windowY = Math.max(displayY, windowY)
      }

      window.setPosition(Math.floor(windowX), Math.floor(windowY))
    }
    catch (error) {
      console.warn('设置窗口位置失败:', error)
    }
  }

  /**
   * 停止监控
   */
  stop(): void {
    if (this.selectionHook && this.isStarted) {
      this.selectionHook.stop()
      this.isStarted = false
      console.log('selection-hook 已停止')
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    if (this.selectionHook) {
      this.stop()
      this.selectionHook.cleanup()
      this.selectionHook = null
      console.log('selection-hook 已清理')
    }
  }

  /**
   * 获取当前选中的文本
   */
  getCurrentSelection(): { text: string } | null {
    if (!this.selectionHook) {
      return null
    }

    const currentSelection = this.selectionHook.getCurrentSelection()
    if (currentSelection) {
      return {
        text: currentSelection.text,
      }
    }

    return null
  }
}

/** 导出单例 */
export const selectionManager = new SelectionManager()

/**
 * 初始化 Selection Hook
 */
export function initSelectionHook(): void {
  selectionManager.init().catch((error) => {
    console.error('初始化 selection-hook 失败:', error)
  })
}

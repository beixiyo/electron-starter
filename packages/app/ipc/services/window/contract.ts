import type { IpcContract } from '@ipc/core'
import type { WindowBounds, WindowConfig, WindowMetadata, WindowType } from '@shared'

export type WindowContract = IpcContract<{
  mainHandle: {
    create: (type: WindowType, configOverride?: Partial<WindowConfig>) => { success: boolean, windowId?: number, error?: string }
    openOAuth: (url: string) => { success: boolean, windowId?: number, error?: string }
    openExternal: (url: string) => { success: boolean, error?: string }
    show: (type: WindowType) => { success: boolean }
    hide: (type: WindowType) => { success: boolean }
    toggle: (type: WindowType) => { success: boolean, visible: boolean }
    destroy: (type: WindowType) => { success: boolean }
    /** 关闭窗口，遵守该窗口的 close 拦截策略 */
    close: (type: WindowType) => { success: boolean }
    /** 最小化窗口 */
    minimize: (type: WindowType) => { success: boolean }
    /** 切换原生全屏 */
    toggleFullScreen: (type: WindowType) => { success: boolean }
    /** 等待现有窗口首屏加载完成 */
    whenReady: (type: WindowType) => { success: boolean }
    /** 调整调用方窗口的系统按钮可见性 */
    setWindowButtonVisibility: (visible: boolean) => { success: boolean }
    /** 输入法组字期间临时降低调用方窗口层级 */
    setImeComposing: (composing: boolean) => { success: boolean }
    /** 按统一开发工具门禁打开调用方窗口的调试器 */
    openDevTools: () => { success: boolean }

    isVisible: (type: WindowType) => { visible: boolean }
    exists: (type: WindowType) => { exists: boolean }
    getMetadata: (type: WindowType) => { metadata: WindowMetadata | undefined }
    getAllTypes: () => { types: WindowType[] }
    release: (type: WindowType | undefined, result?: unknown) => { success: boolean }
    isHolding: (type: WindowType | undefined) => { isHolding: boolean }
    getState: (type: WindowType | undefined) => { state: unknown }
    resizeTo: (type: WindowType, width: number, height: number, animate?: boolean) => { success: boolean }
    setBounds: (type: WindowType, bounds: Partial<WindowBounds>, animate?: boolean) => { success: boolean }
    getBounds: (type: WindowType) => { bounds: WindowBounds | null }
    setIgnoreMouseEvents: (type: WindowType, ignore: boolean, options?: WindowIgnoreMouseEventsOptions) => { success: boolean }
  }
}>

export type WindowIgnoreMouseEventsOptions = {
  /**
   * 忽略鼠标事件时继续把 mousemove 转发给 WebContents
   *
   * @default false
   */
  forward?: boolean
}

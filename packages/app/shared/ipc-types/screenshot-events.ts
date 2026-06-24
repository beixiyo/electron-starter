import type { WindowType } from '../types/window'

export type ScreenshotBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type ScreenshotInitPayload = {
  base64: string
  displayId: number
  scaleFactor: number
}

/**
 * 全局快捷键截图（无渲染端申请方）的兜底消费方角色
 *
 * 主进程在快捷键触发时按当前活跃功能裁决投递目标，并在完成事件 payload 上携带该角色；
 * 渲染端无人持有该 captureId，由声明了对应 `fallbackRole` 的消费者接收
 *
 * 模板内置 `main`（投递给主窗），下游项目按需扩展为联合类型（如 `'recorderNote' | 'askWindow'`）
 */
export type ScreenshotFallbackTarget = 'main'

/**
 * 截图完成事件 payload，仅定向发给本次会话的发起方 webContents
 */
export type ScreenshotOkPayload = {
  /** 本次截图会话 id，消费方需校验等于自己申请到的 id 才消费 */
  captureId: string
  base64: string
  bounds: ScreenshotBounds
  /**
   * 仅全局快捷键发起的会话携带：标记兜底消费方角色，
   * 渲染端无人持有该 captureId，由声明了对应 fallbackRole 的消费者接收
   */
  fallback?: ScreenshotFallbackTarget
}

/**
 * 截图取消事件 payload（用户取消 / 新会话作废旧会话），定向发给会话发起方
 */
export type ScreenshotCancelPayload = {
  captureId: string
}

/**
 * `startCapture` 入参
 */
export type ScreenshotStartOptions = {
  /** 截图期间临时隐藏（透明化）的窗口类型列表 */
  hideWindows?: WindowType[]
  /**
   * 发起方调试标识，仅用于主进程日志，不参与事件路由
   */
  requester?: string
}

/**
 * `startCapture` 返回值：主进程生成的会话 id
 */
export type ScreenshotStartResult = {
  captureId: string
}

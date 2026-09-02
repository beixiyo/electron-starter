import type { WindowType } from '../types/window'

export type ScreenshotBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type ScreenshotInitPayload = {
  /** 本次截图会话 id，用于忽略取消后迟到的初始化结果 */
  captureId: string
  /** 整屏 PNG 二进制；截图窗转换成 Blob URL 展示，不经过 base64 */
  bytes: ArrayBuffer
  displayId: number
  /** 截图物理像素 / overlay CSS 像素的横向比例 */
  scaleX: number
  /** 截图物理像素 / overlay CSS 像素的纵向比例 */
  scaleY: number
}

/** 释放截图窗当前底图；captureId 防止迟到事件清掉下一轮截图 */
export type ScreenshotResetPayload = {
  captureId: string
}

/**
 * 截图产物的 MIME 类型
 *
 * 整条链路固定 PNG（主进程 `nativeImage.toPNG()`），渲染端据此组装 Blob，
 * 不从 payload 现猜类型
 */
export const SCREENSHOT_MIME_TYPE = 'image/png'

/**
 * 截图完成事件 payload，仅定向发给本次会话的发起方 webContents
 */
export type ScreenshotOkPayload = {
  /** 本次截图会话 id，消费方需校验等于自己申请到的 id 才消费 */
  captureId: string
  /**
   * 裁剪后的 PNG 二进制
   *
   * 不发 base64：主进程裁出来的本就是 PNG Buffer，编码成 base64 过 IPC 要膨胀 33%，
   * 渲染端为了落盘 / 上传再解回 Blob 又是一次全量拷贝，两头都白付。需要 dataURL 的
   * 消费方由 `useScreenshotSession` 的 `resType: 'base64'` 就地编码，
   * 成本落在真正需要它的那一侧
   */
  bytes: ArrayBuffer
  bounds: ScreenshotBounds
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

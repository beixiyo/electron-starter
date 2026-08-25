import type { HandleImgReturn, TransferType } from '@jl-org/tool'
import type { ScreenshotFallbackTarget, ScreenshotOkPayload, ScreenshotStartOptions } from '@shared'
import { blobToBase64 } from '@jl-org/tool'
import { useLatestCallback } from 'hooks'
import { useEffect, useRef } from 'react'
import { SCREENSHOT_MIME_TYPE } from '@shared'
import { isElectron } from '@/utils/env'

/**
 * 区域截图会话（申请制，仅 Electron 可用）
 *
 * 流程：`startCapture()` 向主进程申请会话并记下返回的 `captureId`（存 ref）→
 * 用户框选确认 → 主进程把 `ok` 事件 **定向** 发回发起方 webContents →
 * 本 hook 校验 `payload.captureId` 等于自己申请到的 id 才消费，消费/取消后清 ref
 *
 * 同窗口多个 feature 各持有自己的 captureId 天然隔离；共享组件在任意窗口渲染
 * 都安全（主进程定向投递 + captureId 校验双保险）。主进程同一时刻只保留一个
 * 活跃会话，新申请会作废旧会话（旧发起方收到定向 `cancel` 事件清理 ref）
 *
 * 全局快捷键发起的截图没有渲染端申请方，主进程按活跃功能裁决投递目标并在 payload
 * 上携带 `fallback` 角色；声明了对应 `fallbackRole` 且当前没有自有会话的消费者负责
 * 接收。**同一窗口同一角色只允许一个挂载实例**
 *
 * 结果形态由 `options.resType` 决定并反映到 `onCaptured` 的入参类型上：
 * IPC 送来的是 PNG 二进制，`'blob'` 零转换直接交付，`'base64'` 才就地编码
 *
 * Web 环境下 `available` 为 false，不订阅也不触发，调用方据此隐藏截图按钮
 *
 * @example
 * ```ts
 * // 落盘 / 上传：拿 Blob，不经 base64
 * useScreenshotSession(blob => void persist(blob), { resType: 'blob' })
 * // 直接塞 <img src> 或跨窗口传字符串：拿 dataURL
 * useScreenshotSession(dataUrl => setPreview(dataUrl))
 * ```
 */
export function useScreenshotSession<T extends TransferType = 'base64'>(
  onCaptured: (result: HandleImgReturn<T>) => void,
  options?: UseScreenshotSessionOptions<T>,
) {
  const handleCaptured = useLatestCallback(onCaptured)
  const { fallbackRole, requester, resType } = options ?? {}

  /** 当前持有的会话 id；null 表示没有进行中的截图申请 */
  const captureIdRef = useRef<string | null>(null)

  /** 是否该由本消费者处理这条完成事件 */
  const shouldConsume = useLatestCallback((payload: ScreenshotOkPayload | undefined): boolean => {
    if (!payload?.captureId)
      return false

    /** 自己申请的会话 */
    if (payload.captureId === captureIdRef.current)
      return true

    /** 全局快捷键会话：无人持有 captureId，由声明了对应兜底角色的消费者接收 */
    return captureIdRef.current === null
      && !!fallbackRole
      && payload.fallback === fallbackRole
  })

  /** 按 `resType` 交付结果；base64 编码是异步的，会话 id 已在调用前清掉 */
  const deliverCapture = useLatestCallback(async (bytes: ArrayBuffer) => {
    const blob = new Blob([bytes], { type: SCREENSHOT_MIME_TYPE })
    const result = resType === 'blob'
      ? blob
      : await blobToBase64(blob)

    handleCaptured(result as HandleImgReturn<T>)
  })

  useEffect(() => {
    if (!isElectron())
      return

    const offOk = $ipc.screenshot.on('ok', (payload) => {
      if (!shouldConsume(payload))
        return

      captureIdRef.current = null
      if (!payload.bytes?.byteLength)
        return

      /** 交付失败不重试：用户可以直接重新截图，卡住一个空会话反而更糟 */
      void deliverCapture(payload.bytes).catch((error) => {
        console.error('failed to deliver screenshot result', error)
      })
    })

    /** 用户取消 / 新会话作废旧会话：清掉本地持有的会话 id */
    const offCancel = $ipc.screenshot.on('cancel', (payload) => {
      if (payload?.captureId === captureIdRef.current)
        captureIdRef.current = null
    })

    return () => {
      offOk()
      offCancel()
    }
  }, [])

  const startCapture = useLatestCallback(async (startOptions?: Pick<ScreenshotStartOptions, 'hideWindows'>) => {
    if (!isElectron())
      return

    const { captureId } = await $ipc.screenshot.startCapture({
      ...startOptions,
      requester,
    })
    captureIdRef.current = captureId
  })

  return {
    /** 当前环境是否支持截图（仅 Electron） */
    available: isElectron(),
    /** 申请截图会话并唤起选区覆盖层 */
    startCapture,
  }
}

export type UseScreenshotSessionOptions<T extends TransferType = 'base64'> = {
  /**
   * 截图结果交付给 `onCaptured` 的形态
   *
   * - `'blob'`：直接给 PNG Blob，落盘 / 上传路径零转换
   * - `'base64'`：编码成 dataURL，供要直接塞 `<img src>` 或跨窗口传字符串的消费方
   *
   * @default 'base64'
   */
  resType?: T
  /**
   * 全局快捷键截图的兜底消费角色：主进程裁决的 `fallback` 与之匹配、
   * 且本消费者当前没有自有会话时才接收。同一窗口同一角色只允许一个挂载实例
   */
  fallbackRole?: ScreenshotFallbackTarget
  /**
   * 发起方调试标识，仅用于主进程日志，不参与路由
   */
  requester?: string
}

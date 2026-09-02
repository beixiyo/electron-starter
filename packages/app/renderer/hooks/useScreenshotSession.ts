import type { HandleImgReturn, TransferType } from '@jl-org/tool'
import type { ScreenshotStartOptions } from '@shared'
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
 * 结果形态由 `options.resType` 决定并反映到 `onCaptured` 的入参类型上：
 * IPC 送来的是 PNG 二进制，`'blob'` 零转换直接交付，`'base64'` 才就地编码
 *
 * Web 环境下 `available` 为 false，不订阅也不触发，调用方据此隐藏截图按钮
 *
 * @example
 * ```ts
 * // 默认拿 Blob，不经 base64；展示方用 URL.createObjectURL 并负责 revoke
 * useScreenshotSession(blob => void persist(blob))
 * // 只有必须跨窗口传字符串的旧接口才显式请求 dataURL
 * useScreenshotSession(dataUrl => sendLegacyPayload(dataUrl), { resType: 'base64' })
 * ```
 */
export function useScreenshotSession<T extends TransferType = 'blob'>(
  onCaptured: (result: HandleImgReturn<T>) => void,
  options?: UseScreenshotSessionOptions<T>,
) {
  const handleCaptured = useLatestCallback(onCaptured)
  const { onCancelled, onError, requester } = options ?? {}
  const resType = options?.resType ?? 'blob'
  const handleCancelled = useLatestCallback(() => onCancelled?.())
  const handleError = useLatestCallback((error: unknown) => onError?.(error))

  /** 当前持有的会话 id；null 表示没有进行中的截图申请 */
  const captureIdRef = useRef<string | null>(null)

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
      if (!payload?.captureId || payload.captureId !== captureIdRef.current)
        return

      captureIdRef.current = null
      if (!payload.bytes?.byteLength) {
        handleError(new Error('Screenshot result is empty'))
        return
      }

      /** 交付失败不重试：用户可以直接重新截图，卡住一个空会话反而更糟 */
      void deliverCapture(payload.bytes).catch((error) => {
        console.error('failed to deliver screenshot result', error)
        handleError(error)
      })
    })

    /** 用户取消 / 新会话作废旧会话：清掉本地持有的会话 id */
    const offCancel = $ipc.screenshot.on('cancel', (payload) => {
      if (payload?.captureId !== captureIdRef.current)
        return

      captureIdRef.current = null
      handleCancelled()
    })

    return () => {
      offOk()
      offCancel()
    }
  }, [deliverCapture, handleCancelled, handleError])

  const startCapture = useLatestCallback(async (startOptions?: Pick<ScreenshotStartOptions, 'hideWindows'>) => {
    if (!isElectron())
      return

    const { captureId } = await $ipc.screenshot.startCapture({
      ...startOptions,
      requester,
    })
    if (!captureId)
      throw new Error('Screenshot capture did not start')

    captureIdRef.current = captureId
  })

  return {
    /** 当前环境是否支持截图（仅 Electron） */
    available: isElectron(),
    /** 申请截图会话并唤起选区覆盖层 */
    startCapture,
  }
}

export type UseScreenshotSessionOptions<T extends TransferType = 'blob'> = {
  /**
   * 截图结果交付给 `onCaptured` 的形态
   *
   * - `'blob'`：直接给 PNG Blob，落盘 / 上传路径零转换
   * - `'base64'`：编码成 dataURL，供要直接塞 `<img src>` 或跨窗口传字符串的消费方
   *
   * @default 'blob'
   */
  resType?: T
  /**
   * 发起方调试标识，仅用于主进程日志，不参与路由
   */
  requester?: string
  /** 用户取消、选择保存到文件或会话被新申请替换时触发 */
  onCancelled?: () => void
  /** 截图结果为空或交付转换失败时触发 */
  onError?: (error: unknown) => void
}

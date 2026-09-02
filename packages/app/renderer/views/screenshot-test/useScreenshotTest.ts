/** 截图功能测试页状态：管理真实截图会话、Blob URL 生命周期与性能数据 */

import { useScreenshotSession } from '@/hooks'
import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'

export function useScreenshotTest() {
  const previewUrlRef = useRef<string | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const [result, setResult] = useState<ScreenshotTestResult | null>(null)
  const [dimensions, setDimensions] = useState<ScreenshotDimensions | null>(null)
  const [openingDurationMs, setOpeningDurationMs] = useState<number | null>(null)
  const [status, setStatus] = useState<ScreenshotTestStatus>({
    kind: 'idle',
    message: '点击开始截图，框选后确认即可在这里检查原始 PNG',
  })

  const revokePreviewUrl = useLatestCallback(() => {
    if (!previewUrlRef.current)
      return

    URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = null
  })

  const handleCaptured = useLatestCallback((blob: Blob) => {
    const startedAt = startedAtRef.current
    startedAtRef.current = null

    revokePreviewUrl()
    const previewUrl = URL.createObjectURL(blob)
    previewUrlRef.current = previewUrl

    setDimensions(null)
    setResult({
      blob,
      previewUrl,
      capturedAt: new Date(),
      totalDurationMs: startedAt === null
        ? null
        : performance.now() - startedAt,
    })
    setStatus({
      kind: 'success',
      message: '已收到原始 PNG Blob；确认操作也已把图片写入系统剪贴板',
    })
  })

  const handleCancelled = useLatestCallback(() => {
    startedAtRef.current = null
    setStatus({
      kind: 'cancelled',
      message: '截图会话已结束；取消或保存到文件时不会向测试页回传图片',
    })
  })

  const handleError = useLatestCallback((error: unknown) => {
    startedAtRef.current = null
    setStatus({
      kind: 'error',
      message: formatScreenshotError(error),
    })
  })

  const session = useScreenshotSession(handleCaptured, {
    requester: 'screenshot-test-page',
    onCancelled: handleCancelled,
    onError: handleError,
  })

  useEffect(() => {
    return () => revokePreviewUrl()
  }, [revokePreviewUrl])

  const startCapture = useLatestCallback(async () => {
    if (!session.available) {
      setStatus({
        kind: 'unavailable',
        message: '当前是 Web 预览模式，请在 Electron 主窗口中测试截图',
      })
      return
    }

    const startedAt = performance.now()
    startedAtRef.current = startedAt
    setOpeningDurationMs(null)
    setStatus({ kind: 'opening', message: '正在抓取屏幕并打开框选浮层…' })

    try {
      await session.startCapture()
      if (startedAtRef.current !== startedAt)
        return

      setOpeningDurationMs(performance.now() - startedAt)
      setStatus({ kind: 'selecting', message: '截图浮层已打开，请框选区域后确认' })
    }
    catch (error) {
      if (startedAtRef.current === startedAt)
        handleError(error)
    }
  })

  const updateDimensions = useLatestCallback((width: number, height: number) => {
    setDimensions({ width, height })
  })

  const clearResult = useLatestCallback(() => {
    revokePreviewUrl()
    setResult(null)
    setDimensions(null)
    setStatus({
      kind: 'idle',
      message: '预览已清除，可以开始下一次截图',
    })
  })

  const downloadResult = useLatestCallback(() => {
    if (!result)
      return

    const link = document.createElement('a')
    link.href = result.previewUrl
    link.download = `screenshot-${formatFileTimestamp(result.capturedAt)}.png`
    link.click()
  })

  return {
    available: session.available,
    busy: status.kind === 'opening' || status.kind === 'selecting',
    status,
    result,
    dimensions,
    openingDurationMs,
    startCapture,
    updateDimensions,
    clearResult,
    downloadResult,
  }
}

function formatScreenshotError(error: unknown): string {
  if (error instanceof Error && error.message === 'Screenshot capture did not start')
    return '截图未启动，请检查屏幕录制权限后重试'

  return error instanceof Error
    ? `截图失败：${error.message}`
    : '截图失败，请查看主进程日志'
}

function formatFileTimestamp(date: Date): string {
  return date.toISOString().replaceAll(':', '-').replace('T', '-').slice(0, 19)
}

export type ScreenshotTestStatus = {
  kind: 'idle' | 'opening' | 'selecting' | 'success' | 'cancelled' | 'error' | 'unavailable'
  message: string
}

export type ScreenshotTestResult = {
  blob: Blob
  previewUrl: string
  capturedAt: Date
  /** 从点击开始到结果回传，包含人工框选时间 */
  totalDurationMs: number | null
}

export type ScreenshotDimensions = {
  width: number
  height: number
}

import type { ScreenshotInitPayload } from '@shared'
import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'
import { useScreenshotKeyboard } from './useScreenshotKeyboard'
import { useSelectionInteraction } from './useSelectionInteraction'

/**
 * 截图窗口顶层编排：串起 init 底图、选区交互、键盘与 IPC 出口
 *
 * 自身不含几何计算与交互状态，只负责把三方接在一起并对接 $ipc
 */
export function useScreenshot() {
  const [initData, setInitData] = useState<ScreenshotInitPayload | null>(null)

  const {
    selection,
    isConfirmed,
    activeHandle,
    cursor,
    handleMouseDown,
    nudge,
    nudgeSize,
    reset: resetSelection,
  } = useSelectionInteraction()

  /** requestInit 的旧结果可能在 reset 后才返回，记录最近释放的会话避免底图复活 */
  const lastResetCaptureIdRef = useRef<string | null>(null)

  const applyInitData = useLatestCallback((data: ScreenshotInitPayload) => {
    if (lastResetCaptureIdRef.current === data.captureId)
      return

    resetSelection()
    setInitData(data)
  })

  useEffect(() => {
    const offInit = $ipc.screenshot.on('init', applyInitData)
    const offReset = $ipc.screenshot.on('reset', ({ captureId }) => {
      lastResetCaptureIdRef.current = captureId
      resetSelection()
      setInitData(prev => prev?.captureId === captureId
        ? null
        : prev)
    })

    /** 预热窗口通常已经订阅；首次即时创建时用回拉兜住 init 竞态 */
    void $ipc.screenshot.requestInit().then((data) => {
      if (data)
        applyInitData(data)
    })

    return () => {
      offInit()
      offReset()
    }
  }, [applyInitData, resetSelection])

  const handleConfirm = useLatestCallback(() => {
    if (!selection || !initData)
      return
    $ipc.screenshot.confirmCapture(initData.displayId, selection)
  })

  const handleSave = useLatestCallback(() => {
    if (!selection || !initData)
      return
    $ipc.screenshot.saveCapture(initData.displayId, selection)
  })

  const handleCancel = useLatestCallback(() => {
    $ipc.screenshot.cancelCapture()
  })

  useScreenshotKeyboard({
    canOperate: isConfirmed && !!selection,
    onCancel: handleCancel,
    onConfirm: handleConfirm,
    onNudge: nudge,
    onNudgeSize: nudgeSize,
  })

  return {
    initData,
    selection,
    isConfirmed,
    activeHandle,
    cursor,
    handleMouseDown,
    handleConfirm,
    handleSave,
    handleCancel,
  }
}

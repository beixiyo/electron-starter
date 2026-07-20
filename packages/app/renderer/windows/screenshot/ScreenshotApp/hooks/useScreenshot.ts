import type { ScreenshotInitPayload } from '@shared'
import { useLatestCallback } from 'hooks'
import { useEffect, useState } from 'react'
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
  } = useSelectionInteraction()

  useEffect(() => {
    return $ipc.screenshot.on('init', setInitData)
  }, [])

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

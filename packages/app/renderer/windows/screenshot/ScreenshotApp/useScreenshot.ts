import type { ScreenshotBounds, ScreenshotInitPayload } from '@shared'
import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'

type SelectionRect = ScreenshotBounds

type DragState = {
  startX: number
  startY: number
}

export function useScreenshot() {
  const [initData, setInitData] = useState<ScreenshotInitPayload | null>(null)
  const [selection, setSelection] = useState<SelectionRect | null>(null)
  const [isConfirmed, setIsConfirmed] = useState(false)
  const dragRef = useRef<DragState | null>(null)

  useEffect(() => {
    return $ipc.screenshot.on('init', (data) => {
      setInitData(data)
    })
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        $ipc.screenshot.cancelCapture()
      }
      if (e.key === 'Enter' && isConfirmed && selection && initData) {
        $ipc.screenshot.confirmCapture(initData.displayId, selection)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isConfirmed, selection, initData])

  const handleMouseDown = useLatestCallback((e: React.MouseEvent) => {
    if (e.button !== 0)
      return

    if (isConfirmed && selection) {
      const inSelection
        = e.clientX >= selection.x
          && e.clientX <= selection.x + selection.width
          && e.clientY >= selection.y
          && e.clientY <= selection.y + selection.height

      if (inSelection)
        return

      setSelection(null)
      setIsConfirmed(false)
    }

    dragRef.current = { startX: e.clientX, startY: e.clientY }
    setSelection(null)
    setIsConfirmed(false)
  })

  const handleMouseMove = useLatestCallback((e: React.MouseEvent) => {
    if (!dragRef.current)
      return

    const { startX, startY } = dragRef.current
    setSelection({
      x: Math.min(startX, e.clientX),
      y: Math.min(startY, e.clientY),
      width: Math.abs(e.clientX - startX),
      height: Math.abs(e.clientY - startY),
    })
  })

  const handleMouseUp = useLatestCallback(() => {
    if (!dragRef.current)
      return
    dragRef.current = null

    if (selection && selection.width > 5 && selection.height > 5) {
      setIsConfirmed(true)
    }
    else {
      setSelection(null)
    }
  })

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

  return {
    initData,
    selection,
    isConfirmed,
    isDragging: !!dragRef.current,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleConfirm,
    handleSave,
    handleCancel,
  }
}

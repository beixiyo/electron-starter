import { memo, useEffect, useState } from 'react'
import { SCREENSHOT_MIME_TYPE } from '@shared'
import {
  ScreenshotToolbar,
  SelectionBox,
  SelectionHandles,
  SizeIndicator,
} from './components'
import { useScreenshot } from './hooks'

export const ScreenshotApp = memo(() => {
  const {
    initData,
    selection,
    isConfirmed,
    activeHandle,
    cursor,
    handleMouseDown,
    handleConfirm,
    handleSave,
    handleCancel,
  } = useScreenshot()

  const [imageUrl, setImageUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!initData) {
      setImageUrl(null)
      return
    }

    const nextImageUrl = URL.createObjectURL(new Blob([initData.bytes], { type: SCREENSHOT_MIME_TYPE }))
    setImageUrl(nextImageUrl)

    return () => {
      URL.revokeObjectURL(nextImageUrl)
    }
  }, [initData])

  if (!initData || !imageUrl)
    return null

  const hasSelection = !!selection && selection.width > 0 && selection.height > 0

  return (
    <div
      className="fixed inset-0 select-none"
      style={ { cursor } }
      onMouseDown={ handleMouseDown }
    >
      <img
        src={ imageUrl }
        className="fixed inset-0 size-full object-fill pointer-events-none"
        draggable={ false }
        alt=""
      />

      {!selection && (
        <div className="fixed inset-0 bg-text/40 pointer-events-none" />
      )}

      {hasSelection && (
        <>
          <SelectionBox selection={ selection } />

          <SizeIndicator
            x={ selection.x }
            y={ selection.y }
            width={ selection.width }
            height={ selection.height }
            scaleX={ initData.scaleX }
            scaleY={ initData.scaleY }
          />

          {isConfirmed && (
            <>
              <SelectionHandles
                selection={ selection }
                activeHandle={ activeHandle }
              />

              <ScreenshotToolbar
                selection={ selection }
                onConfirm={ handleConfirm }
                onSave={ handleSave }
                onCancel={ handleCancel }
              />
            </>
          )}
        </>
      )}
    </div>
  )
})

ScreenshotApp.displayName = 'ScreenshotApp'

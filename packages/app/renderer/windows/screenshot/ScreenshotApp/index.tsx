import { memo } from 'react'
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

  if (!initData)
    return null

  const hasSelection = !!selection && selection.width > 0 && selection.height > 0

  return (
    <div
      className="fixed inset-0 select-none"
      style={ { cursor } }
      onMouseDown={ handleMouseDown }
    >
      <img
        src={ `data:image/png;base64,${initData.base64}` }
        className="fixed inset-0 size-full object-cover pointer-events-none"
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
            scaleFactor={ initData.scaleFactor }
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

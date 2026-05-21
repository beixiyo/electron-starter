import { memo } from 'react'
import { cn } from 'utils'

import { ScreenshotToolbar } from './ScreenshotToolbar'
import { useScreenshot } from './useScreenshot'

export const ScreenshotApp = memo(() => {
  const {
    initData,
    selection,
    isConfirmed,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleConfirm,
    handleSave,
    handleCancel,
  } = useScreenshot()

  if (!initData)
    return null

  const imageSrc = `data:image/png;base64,${initData.base64}`

  return (
    <div
      className={ cn(
        'fixed inset-0 select-none',
        !isConfirmed && 'cursor-crosshair',
      ) }
      onMouseDown={ handleMouseDown }
      onMouseMove={ handleMouseMove }
      onMouseUp={ handleMouseUp }
    >
      <img
        src={ imageSrc }
        className="fixed inset-0 size-full object-cover pointer-events-none"
        draggable={ false }
        alt=""
      />

      {!selection && (
        <div className="fixed inset-0 bg-black/40 pointer-events-none" />
      )}

      {selection && selection.width > 0 && selection.height > 0 && (
        <>
          <div
            className="fixed border border-white/70 pointer-events-none"
            style={ {
              left: selection.x,
              top: selection.y,
              width: selection.width,
              height: selection.height,
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.4)',
            } }
          />

          <div
            className={ cn(
              'fixed pointer-events-none',
              'text-white/90 text-xs',
              'bg-black/60 backdrop-blur-sm',
              'px-2 py-0.5 rounded',
            ) }
            style={ {
              left: selection.x,
              top: Math.max(0, selection.y - 26),
            } }
          >
            {Math.round(selection.width * initData.scaleFactor)}
            {' x '}
            {Math.round(selection.height * initData.scaleFactor)}
          </div>

          {isConfirmed && (
            <ScreenshotToolbar
              selection={ selection }
              onConfirm={ handleConfirm }
              onSave={ handleSave }
              onCancel={ handleCancel }
            />
          )}
        </>
      )}
    </div>
  )
})

ScreenshotApp.displayName = 'ScreenshotApp'

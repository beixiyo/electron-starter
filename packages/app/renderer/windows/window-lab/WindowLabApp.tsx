/** Window Lab 通用控制台：编辑可见场景并观察真实目标组件。 */

import { memo } from 'react'
import { cn } from 'utils'
import { WindowLabCanvas, WindowLabHeader, WindowLabNativePanel, WindowLabSidebar } from './components'
import { DEFAULT_VOICE_IME_PREVIEW } from './targets/voice-ime/scene'
import type { WindowLabPreview } from './types'
import { useWindowLabController } from './useWindowLabController'

export const WindowLabApp = memo<WindowLabAppProps>((props) => {
  const { initialPreview = DEFAULT_VOICE_IME_PREVIEW, className, ...rest } = props
  const lab = useWindowLabController(initialPreview)
  return (
    <div { ...rest } className={ cn('flex size-full min-h-0 flex-col bg-background text-text', className) }>
      <WindowLabHeader onReset={ lab.reset } onShowUrl={ lab.showUrl } />
      <div className="flex min-h-0 flex-1">
        <WindowLabSidebar adapter={ lab.adapter } preview={ lab.preview } onPreviewChange={ lab.updatePreview } />
        <WindowLabCanvas
          frameRef={ lab.frameRef }
          frameSrc={ lab.frameSrc }
          frameSize={ lab.frameSize }
          zoom={ lab.zoom }
          onZoomChange={ lab.setZoom }
          onFrameLoad={ lab.sendCurrentPreviewToFrame }
        />
        <WindowLabNativePanel
          available={ lab.nativeAvailable }
          frameSize={ lab.frameSize }
          nativeBounds={ lab.nativeBounds }
          notice={ lab.notice }
          onOpen={ lab.openNativePreview }
          onClose={ lab.closeNativePreview }
        />
      </div>
    </div>
  )
})

WindowLabApp.displayName = 'WindowLabApp'

export type WindowLabAppProps = {
  initialPreview?: WindowLabPreview
} & React.HTMLAttributes<HTMLDivElement>

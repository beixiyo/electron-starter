/** Window Lab 中央浏览器画布：iframe 与缩放控制。 */

import { Slider } from 'comps'
import { memo } from 'react'
import { cn } from 'utils'
import type { WindowLabSize } from '../types'

export const WindowLabCanvas = memo<WindowLabCanvasProps>((props) => {
  const { frameRef, frameSrc, frameSize, zoom, onZoomChange, onFrameLoad, className, ...rest } = props
  return (
    <main { ...rest } className={ cn('relative flex min-w-0 flex-1 flex-col bg-background3/70', className) }>
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-background/85 px-4">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-text">Browser canvas</span>
          <span className="rounded-md bg-background3 px-2 py-1 font-mono text-[11px] tabular-nums text-text3">
            { Math.round(frameSize.width) } × { Math.round(frameSize.height) }
          </span>
        </div>
        <label className="flex items-center gap-2 text-xs text-text3">
          <span>Zoom</span>
          <Slider
            ariaLabel="Preview zoom"
            min={ 0.75 }
            max={ 2.5 }
            step={ 0.05 }
            value={ zoom }
            onChange={ onZoomChange }
            className="w-28"
            styleConfig={ {
              handle: { size: 'h-3 w-3' },
              track: { size: 'h-1', background: 'bg-border' },
              fill: { color: 'bg-text' },
            } }
          />
          <span className="w-10 text-right tabular-nums">{ Math.round(zoom * 100) }%</span>
        </label>
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto p-8">
        <div className="flex min-h-full min-w-full items-center justify-center">
          <div className="relative shrink-0" style={ { width: frameSize.width * zoom, height: frameSize.height * zoom } }>
            <iframe
              ref={ frameRef }
              title="Window Lab browser preview"
              src={ frameSrc }
              onLoad={ onFrameLoad }
              className="absolute left-0 top-0 border-0 bg-transparent"
              style={ { width: frameSize.width, height: frameSize.height, transform: `scale(${zoom})`, transformOrigin: 'top left' } }
            />
          </div>
        </div>
      </div>
    </main>
  )
})

WindowLabCanvas.displayName = 'WindowLabCanvas'

export type WindowLabCanvasProps = {
  frameRef: React.RefObject<HTMLIFrameElement | null>
  frameSrc: string
  frameSize: WindowLabSize
  zoom: number
  onZoomChange: (zoom: number) => void
  onFrameLoad: () => void
} & React.HTMLAttributes<HTMLElement>

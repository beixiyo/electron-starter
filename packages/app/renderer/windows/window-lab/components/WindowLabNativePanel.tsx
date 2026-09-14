/** Window Lab 右侧原生预览栏：浏览器环境只展示不可用状态。 */

import { Button } from 'comps'
import { memo } from 'react'
import { cn } from 'utils'
import type { WindowLabBounds, WindowLabSize } from '../types'
import { WindowLabSection } from './WindowLabSection'

export const WindowLabNativePanel = memo<WindowLabNativePanelProps>((props) => {
  const { available, frameSize, nativeBounds, notice, onOpen, onClose, className, ...rest } = props
  return (
    <aside { ...rest } className={ cn('w-64 shrink-0 overflow-y-auto border-l border-border bg-background p-4', className) }>
      <WindowLabSection title="Native preview" description="Uses an isolated BrowserWindow when Electron support is available.">
        <Button type="button" variant="primary" size="sm" block disabled={ !available } onClick={ onOpen } className={ buttonClass }>
          { available
            ? 'Open preview'
            : 'Unavailable in browser' }
        </Button>
        <Button type="button" variant="ghost" size="sm" block disabled={ !available } onClick={ onClose } className={ secondaryButtonClass }>
          Close preview
        </Button>
        <div className="rounded-xl border border-border bg-background2 px-3 py-2 text-xs text-text2">
          <Metric
            label="Runtime"
            value={ available
              ? 'Electron'
              : 'Browser' }
          />
          <Metric label="Canvas" value={ `${Math.round(frameSize.width)} × ${Math.round(frameSize.height)}` } />
          <Metric
            label="Native"
            value={ nativeBounds
              ? `${nativeBounds.width} × ${nativeBounds.height}`
              : 'Closed' }
          />
          { nativeBounds && <Metric label="Position" value={ `${nativeBounds.x}, ${nativeBounds.y}` } /> }
        </div>
      </WindowLabSection>
      <WindowLabSection title="Status">
        <p className="rounded-xl border border-border bg-background2 px-3 py-2 text-xs leading-5 text-text2">{ notice }</p>
      </WindowLabSection>
    </aside>
  )
})

WindowLabNativePanel.displayName = 'WindowLabNativePanel'

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-text3">{ label }</span>
      <span className="font-mono text-[11px] tabular-nums text-text">{ value }</span>
    </div>
  )
}

export type WindowLabNativePanelProps = {
  available: boolean
  frameSize: WindowLabSize
  nativeBounds: WindowLabBounds | null
  notice: string
  onOpen: () => void
  onClose: () => void
} & Omit<React.HTMLAttributes<HTMLElement>, 'onClose'>

const buttonClass =
  'w-full rounded-lg bg-text px-3 py-2 text-xs text-textSpecial transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40'
const secondaryButtonClass =
  'w-full rounded-lg border border-border px-3 py-2 text-xs text-text2 transition-colors hover:bg-background2 disabled:cursor-not-allowed disabled:opacity-40'

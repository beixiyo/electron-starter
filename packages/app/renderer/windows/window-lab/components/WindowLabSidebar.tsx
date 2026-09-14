/** Window Lab 左侧配置栏：target 选择与目标字段编辑。 */

import { memo } from 'react'
import { cn } from 'utils'
import type { WindowLabPreview } from '../types'
import type { WindowLabTargetAdapter } from '../targets/types'
import { WindowLabSection } from './WindowLabSection'

export const WindowLabSidebar = memo<WindowLabSidebarProps>((props) => {
  const { adapter, preview, onPreviewChange, className, ...rest } = props
  const Controls = adapter.Controls
  return (
    <aside { ...rest } className={ cn('w-72 shrink-0 overflow-y-auto border-r border-border bg-background2/70 p-4', className) }>
      <WindowLabSection title="Target" description="The target is fixed to the shared voice input surface.">
        <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-text2">Voice input</div>
      </WindowLabSection>
      <Controls preview={ preview } onChange={ onPreviewChange } />
    </aside>
  )
})

WindowLabSidebar.displayName = 'WindowLabSidebar'

export type WindowLabSidebarProps = {
  adapter: WindowLabTargetAdapter
  preview: WindowLabPreview
  onPreviewChange: (preview: WindowLabPreview) => void
} & React.HTMLAttributes<HTMLElement>

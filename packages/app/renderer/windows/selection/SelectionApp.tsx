import type { SelectionData } from '@shared'
import { WindowType } from '@shared'
import { SHADOW_INSET } from '@shared/window-config/constants'
import { CloseBtn } from 'comps'
import { useTheme } from 'hooks'
import { useEffect, useState } from 'react'
import { cn } from 'utils'

export default function SelectionApp(): React.JSX.Element {
  useTheme()
  const [selectionData, setSelectionData] = useState<SelectionData | null>(null)

  useEffect(() => {
    return $ipc.selection.onDataChange((data) => {
      if (data?.text)
        setSelectionData(data)
    })
  }, [])

  const handleClose = () => $ipc.window.hide(WindowType.SELECTION)

  return (
    <div
      className="w-screen h-screen flex items-stretch"
      style={ { padding: SHADOW_INSET } }
    >
      <div
        className={ cn(
          'flex-1 flex flex-col min-h-0 overflow-hidden',
          'bg-background rounded-2xl',
          'shadow-[0_2px_8px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]',
        ) }
      >
        {/* 标题栏 — 可拖拽区域 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]">
          <span className="text-sm font-medium text-textPrimary select-none">选中文本</span>
          <CloseBtn
            mode="static"
            size="md"
            onClick={ handleClose }
          />
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-auto p-4 min-h-0">
          { selectionData
            ? (
                <div className="space-y-4">
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-textPrimary">
                    { selectionData.text }
                  </p>

                  { (selectionData.programName || selectionData.method) && (
                    <div className="pt-3 border-t border-border text-[11px] text-muted-foreground/60 space-y-1">
                      { selectionData.programName && (
                        <div>
                          <span className="font-medium text-muted-foreground/80">来源</span>
                          { ' ' }
                          { selectionData.programName }
                        </div>
                      ) }
                      { selectionData.method && (
                        <div>
                          <span className="font-medium text-muted-foreground/80">方式</span>
                          { ' ' }
                          { selectionData.method }
                        </div>
                      ) }
                    </div>
                  ) }
                </div>
              )
            : (
                <div className="h-full flex items-center justify-center">
                  <span className="text-xs text-muted-foreground/50">等待选中文本…</span>
                </div>
              ) }
        </div>
      </div>
    </div>
  )
}

import type { SelectionData } from '@shared'
import { WindowType } from '@shared'
import { CloseBtn } from 'comps'
import { useTheme } from 'hooks'
import { useCallback, useEffect, useState } from 'react'
import { cn } from 'utils'

export default function SelectionApp(): React.JSX.Element {
  useTheme()
  const [selectionData, setSelectionData] = useState<SelectionData | null>(null)

  useEffect(() => {
    /** 监听主进程发送的选中文本数据 */
    const cleanup = $ipc.selection.onDataChange((data) => {
      if (data?.text) {
        setSelectionData(data)
      }
    })

    return cleanup
  }, [])

  const handleClose = useCallback(async () => {
    await $ipc.window.hide(WindowType.SELECTION)
  }, [])

  return (
    <div className={ cn(
      'w-full h-full flex flex-col',
      'bg-background text-textPrimary',
    ) }>
      {/* 标题栏 */}
      <div className="relative flex items-center justify-center px-4 py-3 border-b border-border">
        <h2 className="text-lg font-semibold">选中的文本</h2>
        <CloseBtn
          mode="absolute"
          corner="top-right"
          onClick={ handleClose }
          className="mr-2"
        />
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-auto p-4">
        {selectionData
          ? (
              <div className="space-y-4">
                {/* 文本内容 */}
                <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {selectionData.text}
                </div>

                {/* 元数据信息 */}
                {(selectionData.programName || selectionData.method) && (
                  <div className="pt-4 border-t border-border text-xs text-muted-foreground space-y-1">
                    {selectionData.programName && (
                      <div>
                        <span className="font-medium">来源应用:</span>
                        {' '}
                        {selectionData.programName}
                      </div>
                    )}
                    {selectionData.method && (
                      <div>
                        <span className="font-medium">选择方法:</span>
                        {' '}
                        {selectionData.method}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                等待选中文本...
              </div>
            )}
      </div>
    </div>
  )
}

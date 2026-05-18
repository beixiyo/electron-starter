import type { SourceGridProps } from './types'
import { Button, Card } from 'comps'
import { RefreshCw } from 'lucide-react'
import { memo, useMemo } from 'react'
import { cn } from 'utils'

export const SourceGrid = memo<SourceGridProps>((props) => {
  const {
    sources,
    selectedSourceId,
    onSelect,
    canSelect,
    emptyState,
    refresh,
    helperText,
  } = props

  /** 将屏幕类型排在前面，窗口类型排在后面 */
  const sortedSources = useMemo(() => {
    return [...sources].sort((a, b) => {
      /** 屏幕源的ID通常以'screen:'开头，窗口源通常以'window:'开头 */
      const aIsScreen = a.id.startsWith('screen:')
      const bIsScreen = b.id.startsWith('screen:')

      /** 如果a是屏幕而b不是，a排在前面 */
      if (aIsScreen && !bIsScreen) {
        return -1
      }
      /** 如果b是屏幕而a不是，b排在前面 */
      if (!aIsScreen && bIsScreen) {
        return 1
      }
      /** 如果都是屏幕或都是窗口，按名称排序 */
      return a.name.localeCompare(b.name)
    })
  }, [sources])

  return (
    <Card
      shadow="none"
      padding="none"
      className="border-none"
    >
      <div className="mb-5 flex flex-wrap items-center justify-end">
        <Button
          size="sm"
          loading={ refresh.loading }
          onClick={ refresh.onClick }
          disabled={ refresh.loading }
          leftIcon={ <RefreshCw className="size-4" /> }
        >
        </Button>
      </div>

      { sortedSources.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-textSecondary">
          { refresh.loading
            ? emptyState.loading
            : emptyState.empty }
        </div>
      ) }

      { sortedSources.length > 0 && (
        <div className="max-h-[28rem] overflow-y-auto pr-1">
          <div className="grid gap-4 grid-cols-3">
            { sortedSources.map((source) => {
              const isActive = source.id === selectedSourceId
              return (
                <Card
                  key={ source.id }
                  role="button"
                  tabIndex={ canSelect
                    ? 0
                    : -1 }
                  aria-disabled={ !canSelect }
                  rounded="xl"
                  shadow="none"
                  padding="none"
                  title={ !canSelect
                    ? helperText.cannotSwitch
                    : undefined }
                  className={ cn(
                    'border transition-all focus-visible:outline-none',
                    canSelect
                      ? 'cursor-pointer'
                      : 'cursor-not-allowed opacity-60',
                    isActive
                      ? 'border-info bg-infoBg/30 shadow-card'
                      : 'border-border hover:border-info/60 hover:bg-backgroundSubtle/60',
                  ) }
                  bodyClassName="space-y-3 p-3"
                  onClick={ (event) => {
                    if (!canSelect)
                      return
                    event.stopPropagation()
                    onSelect(source.id)
                  } }
                  onKeyDown={ (event) => {
                    if (!canSelect)
                      return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect(source.id)
                    }
                  } }
                >
                  { source.thumbnail
                    ? (
                        <img
                          src={ source.thumbnail }
                          alt={ source.name }
                          className="h-40 w-full rounded-lg object-cover"
                        />
                      )
                    : (
                        <div className="flex h-40 w-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-textSecondary">
                          { helperText.noPreview }
                        </div>
                      ) }
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">{ source.name }</p>
                    {/* <p className="text-xs text-textSecondary">{ source.displayId || helperText.noDisplayId }</p> */}
                    <span className={ cn(
                      'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                      source.canSystemAudio
                        ? 'bg-successBg text-success border-successBg'
                        : 'border-border text-textSecondary',
                    ) }
                    >
                      { source.canSystemAudio
                        ? helperText.supportsSystemAudio
                        : helperText.microphoneAudioOnly }
                    </span>
                  </div>
                </Card>
              )
            }) }
          </div>
        </div>
      ) }
    </Card>
  )
})

SourceGrid.displayName = 'SourceGrid'

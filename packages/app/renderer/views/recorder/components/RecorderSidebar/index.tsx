import type { RecorderSidebarProps } from './types'
import { Button, Card } from 'comps'
import { memo } from 'react'
import { cn } from 'utils'
import { AudioToggleCard } from '../AudioToggleCard'
import { RecordingTimer } from '../RecordingTimer'

export const RecorderSidebar = memo<RecorderSidebarProps>((props) => {
  const {
    stateMeta,
    primaryAction,
    actions,
    audioCards,
    audioSourceBar,
    errorMessage,
    recordingDuration,
    isRecording,
    isPaused,
  } = props

  return (
    <aside className="space-y-5">
      <Card
        rounded="2xl"
        shadow="lg"
        padding="none"
        className="shadow-card"
        bodyClassName="p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <p className={ cn('text-lg font-semibold', stateMeta.accent) }>{ stateMeta.label }</p>
          <RecordingTimer
            duration={ recordingDuration }
            isRecording={ isRecording }
            isPaused={ isPaused }
          />
        </div>

        <div className="mt-6 space-y-3">
          <Button
            variant={ primaryAction.variant }
            size="sm"
            block
            onClick={ primaryAction.onClick }
            disabled={ primaryAction.disabled }
            leftIcon={ primaryAction.icon }
            loading={ primaryAction.loading }
          >
            { primaryAction.label }
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <Button
              size="sm"
              block
              onClick={ actions.onStop }
              disabled={ !actions.isBusy }
              className="border border-border text-textSecondary hover:bg-background"
            >
              { actions.stopLabel }
            </Button>
            <Button
              variant="danger"
              size="sm"
              block
              onClick={ actions.onCancel }
              disabled={ !actions.isBusy }
            >
              { actions.cancelLabel }
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="ghost"
              size="sm"
              block
              onClick={ actions.onReset }
              disabled={ !actions.hasResult }
              className="border border-border text-textSecondary hover:bg-background"
            >
              { actions.resetLabel }
            </Button>
            <Button
              variant="ghost"
              size="sm"
              block
              onClick={ actions.onDownload }
              disabled={ !actions.hasResult }
              className="border border-border text-textSecondary hover:bg-background"
            >
              { actions.downloadLabel }
            </Button>
          </div>
        </div>
      </Card>

      <Card
        rounded="2xl"
        shadow="lg"
        padding="none"
        className="shadow-card"
        bodyClassName="p-5"
      >
        <div className="mb-4">
          <p className="text-sm font-semibold">{ audioCards.title }</p>
        </div>
        { audioSourceBar && (
          <div className="mb-4">
            { audioSourceBar }
          </div>
        ) }
        <div className="space-y-3">
          { audioCards.items.map(card => (
            <AudioToggleCard
              key={ card.title }
              title={ card.title }
              description={ card.description }
              checked={ card.checked }
              disabled={ card.disabled }
              onChange={ card.onChange }
            />
          )) }
        </div>
        { errorMessage && (
          <div className="mt-4 rounded-xl border border-danger bg-dangerBg/40 p-3 text-sm text-danger">
            { errorMessage }
          </div>
        ) }
      </Card>
    </aside>
  )
})

RecorderSidebar.displayName = 'RecorderSidebar'

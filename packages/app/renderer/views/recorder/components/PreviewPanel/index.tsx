import type { PreviewPanelProps } from './types'
import { memo } from 'react'

export const PreviewPanel = memo<PreviewPanelProps>((props) => {
  const {
    title,
    summary,
    audioPreview,
    videoPreview,
  } = props

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-semibold">{ title }</p>
        { summary?.visible && (
          <div className="text-right text-xs text-textSecondary">
            <p>
              { summary.typeLabel }
              { summary.typeValue ?? '--' }
            </p>
            <p>
              { summary.sizeLabel }
              { summary.sizeValue ?? '--' }
            </p>
          </div>
        ) }
      </div>

      { audioPreview && (
        <div className="space-y-4">
          { audioPreview.isLive && (
            <div className="rounded-xl bg-infoBg/30 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-info">{ audioPreview.liveTitle }</p>
                  <p className="text-xs text-textSecondary">{ audioPreview.liveDescription }</p>
                </div>
                <div className="flex items-center gap-2 text-info">
                  <span className="h-2 w-2 rounded-full bg-info animate-ping" />
                  <span className="text-xs font-semibold">{ audioPreview.liveBadgeText }</span>
                </div>
              </div>
              <audio
                ref={ audioPreview.ref }
                className="mt-3 w-full"
                autoPlay
                muted
                controls={ false }
              />
            </div>
          ) }
          { !audioPreview.isLive && !audioPreview.hasResult && (
            <div className="rounded-xl p-6 text-center text-sm text-textSecondary">
              { audioPreview.emptyText }
            </div>
          ) }
          { audioPreview.recordedSrc && (
            <audio
              controls
              className="w-full rounded-xl"
              src={ audioPreview.recordedSrc }
            />
          ) }
        </div>
      ) }

      { videoPreview && (
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border bg-backgroundSubtle text-textPrimary">
          <video
            ref={ videoPreview.ref }
            className="h-full w-full object-contain"
            playsInline
            autoPlay={ videoPreview.isLive }
            muted={ videoPreview.isLive }
            controls={ Boolean(videoPreview.recordedSrc) }
            src={ videoPreview.recordedSrc }
          />
        </div>
      ) }
    </div>
  )
})

PreviewPanel.displayName = 'PreviewPanel'

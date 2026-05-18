import type { ReactNode } from 'react'
import { Audio } from 'comps'
import { Activity, memo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * 屏幕录制预览与下载
 */
export const RecorderPreview = memo((props: RecorderPreviewProps) => {
  const { t } = useTranslation('recorder')
  const { videoRef, blobUrl, isAudio, audioRecorder } = props
  return (
    <div className="col-span-1 md:col-span-2">
      <Activity mode={ isAudio
        ? 'visible'
        : 'hidden' }>
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-900/50">
          { audioRecorder && (
            <div className="mb-4">
              { audioRecorder }
            </div>
          ) }
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            { audioRecorder
              ? t('preview.audioModeDesc')
              : t('preview.videoModeDesc') }
          </p>
          <Activity mode={ blobUrl
            ? 'visible'
            : 'hidden' }>
            <Audio
              className="mt-3 w-full"
              src={ blobUrl || undefined }
              controls
            />
          </Activity>
        </div>

        <Activity mode={ blobUrl
          ? 'visible'
          : 'hidden' }>
          <a
            href={ blobUrl || undefined }
            download={ isAudio
              ? 'record.webm'
              : 'record.webm' }
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline ml-4"
          >
            { isAudio
              ? t('preview.downloadAudio')
              : t('preview.downloadVideo') }
          </a>
        </Activity>
      </Activity>

      <Activity mode={ !isAudio
        ? 'visible'
        : 'hidden' }>
        <div className="aspect-video w-full rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-black/80">
          <video
            ref={ videoRef }
            className="h-full w-full"
            playsInline
            muted
          />
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {t('preview.recordingDesc')}
        </p>
      </Activity>
    </div>
  )
})

RecorderPreview.displayName = 'RecorderPreview'

/**
 * 录制预览组件的参数
 */
export type RecorderPreviewProps = {
  videoRef: React.RefObject<HTMLVideoElement>
  blobUrl: string | null
  /** 是否仅音频模式 */
  isAudio?: boolean
  /**
   * 音频录制可视化挂件
   */
  audioRecorder?: ReactNode | null
}

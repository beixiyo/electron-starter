import { Audio } from 'comps'
import type { ReactNode } from 'react'
import { Activity, memo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * 屏幕录制预览与下载
 */
export const RecorderPreview = memo((props: RecorderPreviewProps) => {
  const { t } = useTranslation('recorder')
  const { videoRef, blobUrl, isAudio, audioRecorder } = props
  return (
    <div className="min-w-0">
      <Activity
        mode={ isAudio
          ? 'visible'
          : 'hidden' }
      >
        <div className="rounded-2xl bg-background2 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
          { audioRecorder && (
            <div className="mb-4">
              { audioRecorder }
            </div>
          ) }
          <p className="text-sm text-text2">
            { audioRecorder
              ? t('preview.audioModeDesc')
              : t('preview.videoModeDesc') }
          </p>
          <Activity
            mode={ blobUrl
              ? 'visible'
              : 'hidden' }
          >
            <Audio
              className="mt-3 w-full"
              src={ blobUrl || undefined }
              controls
            />
          </Activity>
        </div>

        <Activity
          mode={ blobUrl
            ? 'visible'
            : 'hidden' }
        >
          <a
            href={ blobUrl || undefined }
            download={ isAudio
              ? 'record.webm'
              : 'record.webm' }
            className="ml-4 text-sm text-info hover:underline"
          >
            { isAudio
              ? t('preview.downloadAudio')
              : t('preview.downloadVideo') }
          </a>
        </Activity>
      </Activity>

      <Activity
        mode={ !isAudio
          ? 'visible'
          : 'hidden' }
      >
        <div className="aspect-video w-full overflow-hidden rounded-2xl bg-black/80 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
          <video
            ref={ videoRef }
            className="h-full w-full"
            playsInline
            muted
          />
        </div>
        <p className="mt-2 text-xs text-text3">
          { t('preview.recordingDesc') }
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

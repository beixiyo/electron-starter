import { Audio } from 'comps'
import type { ReactNode } from 'react'
import { Activity, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { AudioRecordingStage } from '../shared/components/AudioRecordingStage'
import { VideoPreviewFrame } from '../shared/components/VideoPreviewFrame'

/**
 * 屏幕录制预览与下载
 */
export const RecorderPreview = memo((props: RecorderPreviewProps) => {
  const { t } = useTranslation('recorder')
  const {
    videoRef,
    blobUrl,
    isAudio,
    audioRecorder,
    isRecording,
    isPaused,
    isVideoLive,
    getAudioLevel,
  } = props
  return (
    <div className="min-w-0">
      <Activity
        mode={ isAudio
          ? 'visible'
          : 'hidden' }
      >
        <AudioRecordingStage
          active={ isRecording }
          paused={ isPaused }
          getAudioLevel={ getAudioLevel }
          title={ isRecording
            ? t('preview.audioRecording')
            : isPaused
            ? t('preview.audioPaused')
            : t('preview.audioIdle') }
          description={ t('preview.audioModeDesc') }
          waveform={ audioRecorder }
        />

        { blobUrl && (
          <div className="mt-4 rounded-2xl bg-background2 p-4 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
            <Audio className="w-full" src={ blobUrl } controls />
          </div>
        ) }

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
        <VideoPreviewFrame
          videoRef={ videoRef }
          src={ isVideoLive
            ? undefined
            : blobUrl ?? undefined }
          isLive={ isVideoLive }
        />
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
  videoRef: React.RefObject<HTMLVideoElement | null>
  blobUrl: string | null
  /** 是否仅音频模式 */
  isAudio?: boolean
  /**
   * 音频录制可视化挂件
   */
  audioRecorder?: ReactNode | null
  isRecording: boolean
  isPaused: boolean
  isVideoLive: boolean
  getAudioLevel?: () => number
}

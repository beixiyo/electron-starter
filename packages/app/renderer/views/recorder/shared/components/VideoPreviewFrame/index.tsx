/** 跨平台共享的视频预览框，统一完整显示与比例规则 */

import { memo } from 'react'
import { cn } from 'utils'

/**
 * 使用固定 16:9 舞台承载任意来源比例的视频，并通过 object-contain 保证不裁切画面
 */
export const VideoPreviewFrame = memo<VideoPreviewFrameProps>((props) => {
  const {
    videoRef,
    src,
    isLive = false,
    className,
  } = props

  return (
    <div
      className={ cn(
        'relative aspect-video w-full min-w-0 overflow-hidden rounded-3xl bg-[#111318] shadow-[0_14px_45px_rgba(15,23,42,0.16)]',
        className,
      ) }
    >
      <video
        ref={ videoRef }
        className="size-full object-contain"
        playsInline
        autoPlay={ isLive }
        muted={ isLive }
        controls={ Boolean(src) }
        src={ src }
      />
    </div>
  )
})

VideoPreviewFrame.displayName = 'VideoPreviewFrame'

export type VideoPreviewFrameProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  src?: string
  isLive?: boolean
  className?: string
}

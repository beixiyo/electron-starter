/** 跨平台共享的音频录制舞台，只消费状态与音量，不持有录制引擎 */

import { BottomGlow } from 'comps'
import { Mic2, Pause } from 'lucide-react'
import { memo } from 'react'
import { cn } from 'utils'
import { useAudioLevel } from '../../hooks/useAudioLevel'

/**
 * 音频录制视觉层。Electron 可传 native IPC 音量，Web 可传 Recorder analyser 音量
 */
export const AudioRecordingStage = memo<AudioRecordingStageProps>((props) => {
  const {
    active,
    paused,
    getAudioLevel,
    title,
    description,
    waveform,
    className,
  } = props

  const level = useAudioLevel(getAudioLevel, active)

  return (
    <section
      className={ cn(
        'relative isolate flex min-h-64 min-w-0 flex-col overflow-hidden rounded-3xl bg-background2 px-5 py-5 shadow-[0_14px_45px_rgba(15,23,42,0.08)] sm:min-h-72 sm:px-7 sm:py-6',
        className,
      ) }
    >
      <div className="relative z-10 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-medium text-text">{ title }</h2>
          <p className="mt-1 text-xs leading-5 text-text3">{ description }</p>
        </div>

        <div
          className={ cn(
            'flex size-10 shrink-0 items-center justify-center rounded-full bg-background3 text-text3 transition-colors',
            active && 'bg-brand/10 text-brand',
            paused && 'bg-warningBg text-warning',
          ) }
          aria-hidden="true"
        >
          { paused
            ? <Pause className="size-4" />
            : <Mic2 className="size-4" /> }
        </div>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center py-6">
        { waveform
          ? <div className="h-24 w-full max-w-2xl sm:h-28">{ waveform }</div>
          : (
            <div className="flex items-end gap-1.5" aria-hidden="true">
              { [0.34, 0.58, 0.82, 1, 0.74, 0.5, 0.3].map((weight, index) => (
                <span
                  key={ weight }
                  className="w-1.5 rounded-full bg-brand/55 transition-[height,opacity] duration-100"
                  style={ {
                    height: `${
                      12 + Math.max(
                          level,
                          active
                            ? 0.08
                            : 0,
                        ) * weight * 54
                    }px`,
                    opacity: active
                      ? 0.45 + weight * 0.45
                      : 0.2,
                    transitionDelay: `${index * 12}ms`,
                  } }
                />
              )) }
            </div>
          ) }
      </div>

      <BottomGlow
        level={ level }
        active={ active }
        label={ null }
        minLightWidth={ 0.32 }
        maxLightWidth={ 0.9 }
        glowHeight={ 0.18 }
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-24 aspect-auto rounded-none bg-background2"
      />
    </section>
  )
})

AudioRecordingStage.displayName = 'AudioRecordingStage'

export type AudioRecordingStageProps = {
  active: boolean
  paused: boolean
  getAudioLevel?: () => number
  title: React.ReactNode
  description: React.ReactNode
  /** Web 端可传入同时承担采集职责的 LiveWaveAudio；Electron native 不需要 */
  waveform?: React.ReactNode
  className?: string
}

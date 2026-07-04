import type { AudioSourceSwitchResult } from '@/store/recordingStore'
import { Message } from 'comps'
import { useLatestCallback } from 'hooks'
import { Check, Mic, Volume2 } from 'lucide-react'
import { memo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from 'utils'
import {
  ensureSystemAudioSupportChecked,
  toggleAllAppsSource,
  toggleMicSource,
  useRecordingSourceState,
} from '@/store/recordingStore'

/**
 * 手动录音「音源」多选条（麦克风 + 所有软件系统音轨，多选）
 *
 * - 麦克风：仅录人声；所有软件：全系统混音（Core Audio tap，无需屏幕录制权限）
 * - 开录前选好音源即持久化；native 手动录音进行中点选**即刻热挂/卸**（麦克风轨与系统音轨独立热切）
 * - 至少保留一个音源；macOS < 14.2 或 Web 端整体隐藏
 * 编排收口在 recordingStore，组件只 dispatch + 提示失败
 */
export const AudioSourceBar = memo<AudioSourceBarProps>((props) => {
  const { className } = props

  const { t } = useTranslation('recorder')
  const {
    micEnabled,
    systemAudioMixEnabled,
    audioSourceSwitching,
    systemAudioSupport,
  } = useRecordingSourceState()

  useEffect(() => {
    void ensureSystemAudioSupportChecked()
  }, [])

  const notifyResult = useLatestCallback((result: AudioSourceSwitchResult) => {
    /** switching / not-recording 是无害的忽略态，不提示 */
    if (result.ok || result.reason === 'switching' || result.reason === 'not-recording')
      return

    Message.warning(result.reason === 'need-one-source'
      ? t('audioSource.needOneSource')
      : result.reason === 'permission-denied'
        ? t('audioSource.permissionDenied')
        : t('audioSource.recordFailed'))
  })

  const handleMic = useLatestCallback(async () => {
    notifyResult(await toggleMicSource())
  })

  const handleAllApps = useLatestCallback(async () => {
    notifyResult(await toggleAllAppsSource())
  })

  if (systemAudioSupport !== true)
    return null

  return (
    <div className={ cn('flex flex-col gap-2', className) }>
      <span className="text-xs text-text3">{ t('audioSource.label') }</span>

      <div className="flex flex-wrap items-center gap-2">
        <SourceChip
          icon={ <Mic size={ 12 } className="shrink-0" /> }
          label={ t('audioSource.mic') }
          active={ micEnabled }
          disabled={ audioSourceSwitching }
          onClick={ handleMic }
        />

        <SourceChip
          icon={ <Volume2 size={ 12 } className="shrink-0" /> }
          label={ t('audioSource.allApps') }
          active={ systemAudioMixEnabled }
          disabled={ audioSourceSwitching }
          onClick={ handleAllApps }
        />
      </div>
    </div>
  )
})

AudioSourceBar.displayName = 'AudioSourceBar'

const SourceChip = memo<SourceChipProps>((props) => {
  const {
    icon,
    label,
    active,
    disabled,
    onClick,
  } = props

  return (
    <button
      type="button"
      disabled={ disabled }
      onClick={ onClick }
      className={ cn(
        'flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors',
        active
          ? 'border-brand/40 bg-brand/10 text-brand'
          : 'border-border/80 text-text3 hover:bg-background3 hover:text-text',
        disabled && 'opacity-60',
      ) }
    >
      { active
        ? <Check size={ 12 } className="shrink-0" />
        : icon }
      <span className="max-w-36 truncate">{ label }</span>
    </button>
  )
})

SourceChip.displayName = 'SourceChip'

export type AudioSourceBarProps = {
  className?: string
}

type SourceChipProps = {
  icon?: React.ReactNode
  label: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}

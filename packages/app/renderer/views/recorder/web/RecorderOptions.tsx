import type { CaptureKind, RecorderState } from '@jl-org/tool'
import { Button, Select } from 'comps'
import { Pause, Play } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * 屏幕录制控制与参数面板
 */
export const RecorderOptions = memo((props: RecorderOptionsProps) => {
  const { t } = useTranslation('recorder')
  const {
    recState,
    captureKind,
    isStarting,
    onChangeCaptureKind,
    onStart,
    onPause,
    onResume,
    onStop,
    onCancel,
  } = props

  const kindOptions = [
    { value: 'audio', label: t('options.audioOnly') },
    { value: 'video', label: t('options.audioVideo'), disabled: true },
  ]

  const actionButtonConfig = (() => {
    if (recState === 'recording') {
      return {
        label: t('options.pause'),
        icon: <Pause size={ 16 } />,
        onClick: onPause,
        variant: 'default' as const,
        disabled: false,
        loading: false,
      }
    }

    if (recState === 'paused') {
      return {
        label: t('options.resume'),
        icon: <Play size={ 16 } />,
        onClick: onResume,
        variant: 'default' as const,
        disabled: false,
        loading: false,
      }
    }

    return {
      label: t('options.start'),
      icon: <Play size={ 16 } />,
      onClick: onStart,
      variant: 'primary' as const,
      disabled: isStarting,
      loading: isStarting,
    }
  })()

  return (
    <div className="space-y-4 rounded-2xl bg-background2 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
      <div>
        <label className="mb-1 block text-sm text-text2">{ t('options.recordType') }</label>
        <Select
          options={ kindOptions }
          value={ captureKind }
          onChange={ (v) => onChangeCaptureKind(v) }
          dropdownHeight={ 140 }
        />
      </div>
      {
        /* <div>
        <Checkbox
          checked={ systemAudio }
          onChange={ checked => onChangeSystemAudio(checked) }
          label={t('options.systemAudio')}
          labelClassName="text-sm text-zinc-700 dark:text-zinc-300"
        />
      </div>
      <div>
        <Checkbox
          checked={ micAudio }
          onChange={ checked => onChangeMicAudio(checked) }
          label={t('options.microphone')}
          labelClassName="text-sm text-zinc-700 dark:text-zinc-300"
        />
      </div> */
      }

      {
        /* <div>
        <label className="block text-sm text-zinc-700 dark:text-zinc-300 mb-1">{t('options.timeslice')}</label>
        <NumberInput
          value={ timeslice === ''
            ? ''
            : Number(timeslice) }
          onChange={ val => onChangeTimeslice(Number.isNaN(val)
            ? ''
            : val) }
          min={ 100 }
          step={ 100 }
          placeholder={t('options.timeslicePlaceholder')}
        />
      </div> */
      }

      <div className="flex flex-wrap gap-2 pt-2">
        <Button
          onClick={ actionButtonConfig.onClick }
          disabled={ actionButtonConfig.disabled }
          loading={ actionButtonConfig.loading }
          variant={ actionButtonConfig.variant }
          leftIcon={ actionButtonConfig.icon }
          size="sm"
        >
          { actionButtonConfig.label }
        </Button>
        <Button
          onClick={ onStop }
          disabled={ recState !== 'recording' && recState !== 'paused' }
          variant="success"
          size="sm"
        >
          { t('options.save') }
        </Button>
        <Button
          onClick={ onCancel }
          disabled={ recState !== 'recording' && recState !== 'paused' }
          variant="danger"
          size="sm"
        >
          { t('options.cancel') }
        </Button>
      </div>
    </div>
  )
})

RecorderOptions.displayName = 'RecorderOptions'

/**
 * 录制参数面板所需的配置
 */
export type RecorderOptionsProps = {
  recState: RecorderState
  systemAudio: boolean
  micAudio: boolean
  /** 'video' 录音+录屏，'audio' 仅录音 */
  captureKind: CaptureKind
  timeslice: number | ''
  /** 是否正在启动录制 */
  isStarting: boolean
  onChangeSystemAudio: (v: boolean) => void
  onChangeMicAudio: (v: boolean) => void
  onChangeCaptureKind: (v: CaptureKind) => void
  onChangeTimeslice: (v: number | '') => void
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  /**
   * 销毁当前录制，直接丢弃音视频
   */
  onCancel: () => void
}

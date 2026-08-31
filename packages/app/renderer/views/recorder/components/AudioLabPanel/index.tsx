import type { AudioLabSettings, AudioLabSettingsPatch } from '@shared'
import { useRecordingSourceState } from '@/store/recordingStore'
import { Button, Card, LoadingIcon, Message, NumberInput, Select, Switch } from 'comps'
import { useLatestCallback } from 'hooks'
import { ChevronDown, FlaskConical, RadioTower } from 'lucide-react'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from 'utils'
import { SettingRow } from './SettingRow'
import { StatusPill } from './StatusPill'
import { useAudioLabSettings } from './useAudioLabSettings'

/**
 * Native 录音实验面板
 *
 * 面向项目作者的实验场：基础策略始终可见，AEC3 细节延迟到高级区；所有设置只在
 * idle 时可修改，避免面板显示值与已经启动的 helper 配置不一致
 */
export const AudioLabPanel = memo(() => {
  const { t } = useTranslation('recorder')
  const { micEnabled, phase, systemAudioMixEnabled, systemAudioSelectedPids } = useRecordingSourceState()
  const { error, loading, saving, settings, update } = useAudioLabSettings()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [delayDraft, setDelayDraft] = useState<number | null>(null)

  const disabled = phase !== 'idle' || saving
  const systemEnabled = systemAudioMixEnabled
  const selectedSystemLabel = systemAudioSelectedPids.length > 0
    ? t('audioLab.status.selectedApps', { count: systemAudioSelectedPids.length })
    : t('audioLab.status.allApps')
  const sourceLabel = micEnabled && systemEnabled
    ? t('audioLab.status.micAndSystem', { system: selectedSystemLabel })
    : micEnabled
    ? t('audioLab.status.micOnly')
    : systemEnabled
    ? selectedSystemLabel
    : t('audioLab.status.noSource')

  const echoLabel = getEchoStatusLabel({
    echoCancellation: settings?.echoCancellation,
    micEnabled,
    systemEnabled,
    t,
  })

  const apply = useLatestCallback(async (patch: AudioLabSettingsPatch) => {
    const ok = await update(patch)
    if (!ok)
      Message.warning(t('audioLab.messages.saveFailed'))
  })

  const commitDelay = useLatestCallback(() => {
    if (delayDraft === null || delayDraft === settings?.fixedDelayMs)
      return

    void apply({ fixedDelayMs: delayDraft })
    setDelayDraft(null)
  })

  return (
    <Card
      rounded="2xl"
      shadow="none"
      bordered={ false }
      hoverEffect={ false }
      padding="none"
      className="bg-background2 shadow-[0_8px_30px_rgba(0,0,0,0.06)]"
      bodyClassName="p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical size={ 15 } className="text-brand" />
            <p className="text-sm font-semibold text-text">{ t('audioLab.title') }</p>
          </div>
          <p className="mt-1 text-xs leading-5 text-text3">{ t('audioLab.description') }</p>
        </div>
        { saving && <LoadingIcon size={ 16 } /> }
      </div>

      { loading || !settings
        ? (
            <div className="flex min-h-32 items-center justify-center">
              { error === 'load'
                ? <p className="text-xs text-danger">{ t('audioLab.messages.loadFailed') }</p>
                : <LoadingIcon size={ 18 } /> }
            </div>
          )
        : (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                <StatusPill label={ sourceLabel } />
                <StatusPill
                  label={ echoLabel }
                  active={ settings.echoCancellation === 'auto' && micEnabled && systemEnabled }
                />
                <StatusPill label={ t(`audioLab.status.channels${settings.outputChannels}`) } />
                <StatusPill
                  label={ settings.meetingDetectionEnabled
                    ? t('audioLab.status.meetingOn')
                    : t('audioLab.status.meetingOff') }
                />
              </div>

              <div className="mt-4 space-y-3">
                <SettingRow
                  title={ t('audioLab.outputChannels.title') }
                  description={ t('audioLab.outputChannels.description') }
                  control={ (
                    <Select
                      value={ String(settings.outputChannels) }
                      disabled={ disabled }
                      bordered
                      shadowed={ false }
                      dropdownMaxHeight={ 120 }
                      options={ [
                        { value: '1', label: t('audioLab.outputChannels.mono') },
                        { value: '2', label: t('audioLab.outputChannels.stereo') },
                      ] }
                      onChange={ value => void apply({ outputChannels: value === '1'
                        ? 1
                        : 2 }) }
                    />
                  ) }
                />

                <SettingRow
                  title={ t('audioLab.echoCancellation.title') }
                  description={ t('audioLab.echoCancellation.description') }
                  control={ (
                    <Select
                      value={ settings.echoCancellation }
                      disabled={ disabled }
                      bordered
                      shadowed={ false }
                      dropdownMaxHeight={ 120 }
                      options={ [
                        { value: 'auto', label: t('audioLab.echoCancellation.auto') },
                        { value: 'off', label: t('audioLab.echoCancellation.off') },
                      ] }
                      onChange={ value => void apply({ echoCancellation: value as AudioLabSettings['echoCancellation'] }) }
                    />
                  ) }
                />

                <SettingRow
                  title={ t('audioLab.meetingDetection.title') }
                  description={ t('audioLab.meetingDetection.description') }
                  control={ (
                    <div className="flex justify-end">
                      <Switch
                        size="sm"
                        checked={ settings.meetingDetectionEnabled }
                        disabled={ disabled }
                        ariaLabel={ t('audioLab.meetingDetection.title') }
                        onChange={ value => void apply({ meetingDetectionEnabled: value }) }
                      />
                    </div>
                  ) }
                />
              </div>

              <Button
                variant="ghost"
                size="sm"
                block
                leftIcon={ <RadioTower size={ 14 } /> }
                rightIcon={ (
                  <ChevronDown
                    size={ 14 }
                    className={ cn('transition-transform', advancedOpen && 'rotate-180') }
                  />
                ) }
                className="mt-3 justify-between text-text2"
                onClick={ () => setAdvancedOpen(value => !value) }
              >
                { t('audioLab.advanced.title') }
              </Button>

              { advancedOpen && (
                <div className="mt-3 space-y-3">
                  <SettingRow
                    title={ t('audioLab.delayMode.title') }
                    description={ t('audioLab.delayMode.description') }
                    control={ (
                      <Select
                        value={ settings.delayMode }
                        disabled={ disabled || settings.echoCancellation === 'off' }
                        bordered
                        shadowed={ false }
                        dropdownMaxHeight={ 150 }
                        options={ [
                          { value: 'auto', label: t('audioLab.delayMode.auto') },
                          { value: 'fixed', label: t('audioLab.delayMode.fixed') },
                          { value: 'hybrid', label: t('audioLab.delayMode.hybrid') },
                        ] }
                        onChange={ value => void apply({ delayMode: value as AudioLabSettings['delayMode'] }) }
                      />
                    ) }
                  />

                  <SettingRow
                    title={ t('audioLab.fixedDelay.title') }
                    description={ t('audioLab.fixedDelay.description') }
                    control={ (
                      <NumberInput
                        value={ delayDraft ?? settings.fixedDelayMs }
                        min={ 0 }
                        max={ 500 }
                        step={ 10 }
                        suffix="ms"
                        disabled={ disabled || settings.echoCancellation === 'off' }
                        onChange={ setDelayDraft }
                        onBlur={ commitDelay }
                        onPressEnter={ commitDelay }
                      />
                    ) }
                  />

                  <SettingRow
                    title={ t('audioLab.noiseSuppression.title') }
                    description={ t('audioLab.noiseSuppression.description') }
                    control={ (
                      <Select
                        value={ settings.noiseSuppression }
                        disabled={ disabled || settings.echoCancellation === 'off' }
                        bordered
                        shadowed={ false }
                        dropdownMaxHeight={ 190 }
                        options={ [
                          { value: 'off', label: t('audioLab.levels.off') },
                          { value: 'low', label: t('audioLab.levels.low') },
                          { value: 'moderate', label: t('audioLab.levels.moderate') },
                          { value: 'high', label: t('audioLab.levels.high') },
                          { value: 'very-high', label: t('audioLab.levels.veryHigh') },
                        ] }
                        onChange={ value => void apply({ noiseSuppression: value as AudioLabSettings['noiseSuppression'] }) }
                      />
                    ) }
                  />

                  <SettingRow
                    title={ t('audioLab.gainControl.title') }
                    description={ t('audioLab.gainControl.description') }
                    control={ (
                      <Select
                        value={ settings.gainControl }
                        disabled={ disabled || settings.echoCancellation === 'off' }
                        bordered
                        shadowed={ false }
                        dropdownMaxHeight={ 170 }
                        options={ [
                          { value: 'off', label: t('audioLab.gainControl.off') },
                          { value: 'agc1-adaptive-digital', label: t('audioLab.gainControl.agc1Adaptive') },
                          { value: 'agc1-fixed', label: t('audioLab.gainControl.agc1Fixed') },
                          { value: 'agc2', label: t('audioLab.gainControl.agc2') },
                        ] }
                        onChange={ value => void apply({ gainControl: value as AudioLabSettings['gainControl'] }) }
                      />
                    ) }
                  />

                  <SettingRow
                    title={ t('audioLab.highPass.title') }
                    description={ t('audioLab.highPass.description') }
                    control={ (
                      <div className="flex justify-end">
                        <Switch
                          size="sm"
                          checked={ settings.highPass }
                          disabled={ disabled || settings.echoCancellation === 'off' }
                          ariaLabel={ t('audioLab.highPass.title') }
                          onChange={ value => void apply({ highPass: value }) }
                        />
                      </div>
                    ) }
                  />
                </div>
              ) }

              { phase !== 'idle' && (
                <p className="mt-3 text-xs leading-5 text-warning">
                  { t('audioLab.messages.disabledWhileRecording') }
                </p>
              ) }
            </>
          ) }
    </Card>
  )
})

AudioLabPanel.displayName = 'AudioLabPanel'

function getEchoStatusLabel(options: {
  echoCancellation?: AudioLabSettings['echoCancellation']
  micEnabled: boolean
  systemEnabled: boolean
  t: ReturnType<typeof useTranslation>['t']
}): string {
  if (options.echoCancellation === 'off')
    return options.t('audioLab.status.echoOff')
  if (!options.micEnabled)
    return options.t('audioLab.status.echoNotApplicable')
  if (options.systemEnabled)
    return options.t('audioLab.status.echoActive')
  return options.t('audioLab.status.echoArmed')
}

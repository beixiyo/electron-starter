import type { RuntimeEnvEndpointKey, RuntimeEnvOverride, RuntimeEnvPresetId } from '@/config/runtimeEnv'
import { getRuntimeEnvOverride, resolveRuntimeEnvEndpoints, RUNTIME_ENV_PRESETS, setRuntimeEnvOverride } from '@/config/runtimeEnv'
import { Button, ButtonGroup, Input, Modal } from 'comps'
import { useLatestCallback } from 'hooks'
import { memo, useEffect, useMemo, useState } from 'react'
import { cn } from 'utils'

const PRESET_OPTIONS: PresetOption[] = [
  { value: 'builtin', label: 'Build default', description: 'Use the addresses bundled with this build' },
  ...Object.keys(RUNTIME_ENV_PRESETS).map(value => ({
    value: value as RuntimeEnvPresetId,
    label: value === 'local'
      ? 'Local'
      : value,
    description: 'Use the configured preset endpoints',
  })),
  { value: 'custom', label: 'Custom', description: 'Enter individual addresses; blank fields use the build default' },
]

const ENDPOINT_FIELDS: EndpointField[] = [
  { key: 'apiBaseUrl', label: 'API base', description: 'HTTP API endpoint', placeholder: 'https://example.test/api' },
  { key: 'wsBaseUrl', label: 'WebSocket base', description: 'Realtime endpoint', placeholder: 'wss://example.test/ws' },
  { key: 'appleRedirectUri', label: 'Apple redirect', description: 'OAuth callback endpoint', placeholder: 'https://example.test/callback' },
  { key: 'googleRedirectUri', label: 'Google redirect', description: 'OAuth callback endpoint', placeholder: 'https://example.test/login' },
]

/** 运行环境调试面板；保存失败时保持打开并展示错误。 */
export const EnvSwitchPanel = memo<EnvSwitchPanelProps>((props) => {
  const { isOpen, onClose, className, style } = props
  const [presetId, setPresetId] = useState<RuntimeEnvPresetId>('builtin')
  const [custom, setCustom] = useState<Partial<Record<RuntimeEnvEndpointKey, string>>>({})
  const [saveError, setSaveError] = useState<string>()

  useEffect(() => {
    if (!isOpen) return
    const saved = getRuntimeEnvOverride()
    setPresetId(saved.presetId)
    setCustom({ ...saved.custom })
    setSaveError(undefined)
  }, [isOpen])

  const draft = useMemo<RuntimeEnvOverride>(() => ({ presetId, custom }), [custom, presetId])
  const preview = useMemo(() => resolveRuntimeEnvEndpoints(draft), [draft])
  const activeOption = PRESET_OPTIONS.find((option) => option.value === presetId)

  const handlePresetChange = useLatestCallback((value: string) => {
    if (PRESET_OPTIONS.some(option => option.value === value)) setPresetId(value as RuntimeEnvPresetId)
    setSaveError(undefined)
  })

  const handleCustomChange = useLatestCallback((key: RuntimeEnvEndpointKey, value: string) => {
    setPresetId('custom')
    setCustom((previous) => ({ ...previous, [key]: value }))
    setSaveError(undefined)
  })

  const handleReset = useLatestCallback(() => {
    setPresetId('builtin')
    setCustom({})
    setSaveError(undefined)
  })

  const handleApply = useLatestCallback(() => {
    try {
      setRuntimeEnvOverride(draft)
      onClose()
    }
    catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Unable to save environment settings',
      )
    }
  })

  return (
    <Modal
      isOpen={ isOpen }
      onClose={ onClose }
      titleText="Environment"
      titleAlign="left"
      width={ 560 }
      autoHeight
      innerCloseBtn
      escToClose
      className={ className }
      style={ style }
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={ handleReset } disabled={ presetId === 'builtin' && !Object.keys(custom).length }>
            Reset
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={ onClose }>Cancel</Button>
            <Button variant="primary" size="sm" onClick={ handleApply }>Apply</Button>
          </div>
        </div>
       }
    >
      <div className="flex flex-col gap-4 pb-1 text-xs text-text">
        <ButtonGroup
          active={ presetId }
          onChange={ handlePresetChange }
          rounded={ 8 }
          updateId={ `env-preset-${PRESET_OPTIONS.length}` }
          aria-label="Environment preset"
          bordered={ false }
          className="h-8 w-full bg-background2"
        >
          { PRESET_OPTIONS.map((option) => (
            <Button
              key={ option.value }
              name={ option.value }
              title={ option.description }
              size="sm"
              className="h-8 min-w-0 flex-1 px-2 py-0 text-xs font-medium"
            >
              <span className="truncate">{ option.label }</span>
            </Button>
          )) }
        </ButtonGroup>

        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-text3">{ activeOption?.description }</span>
          <span className="shrink-0 text-[10px] text-text3">
            { presetId === 'builtin'
              ? 'build default'
              : 'customized' }
          </span>
        </div>

        { saveError && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-danger">{ saveError }</p> }

        <div className="flex flex-col gap-2">
          { ENDPOINT_FIELDS.map((field) => (
            <EnvEndpointRow
              key={ field.key }
              field={ field }
              editable={ presetId === 'custom' }
              value={ custom[field.key] ?? '' }
              resolved={ preview[field.key] }
              onChange={ handleCustomChange }
            />
          )) }
        </div>
      </div>
    </Modal>
  )
})

EnvSwitchPanel.displayName = 'EnvSwitchPanel'

const EnvEndpointRow = memo<EnvEndpointRowProps>((props) => {
  const { field, editable, value, resolved, onChange } = props
  const handleChange = useLatestCallback((next: string) => onChange(field.key, next))

  return (
    <div className="grid grid-cols-[168px_minmax(0,1fr)] items-start gap-3">
      <div className="flex min-w-0 flex-col py-1.5">
        <span className="truncate font-medium text-text2">{ field.label }</span>
        <span className="truncate text-[10px] text-text3">{ field.description }</span>
      </div>
      { editable
        ? (
          <Input
            aria-label={ field.label }
            value={ value }
            placeholder={ resolved || field.placeholder }
            onChange={ handleChange }
            size="sm"
            rounded="lg"
            spellCheck={ false }
            autoComplete="off"
            className="text-xs"
          />
        )
        : (
          <span
            className={ cn(
              'break-all rounded-lg bg-background2 px-2.5 py-1.5 text-xs leading-snug',
              resolved
                ? 'text-text2'
                : 'text-text3 italic',
            ) }
          >
            { resolved || 'not configured' }
          </span>
        ) }
    </div>
  )
})

EnvEndpointRow.displayName = 'EnvEndpointRow'

export type EnvSwitchPanelProps = {
  isOpen: boolean
  onClose: () => void
  className?: string
  style?: React.CSSProperties
}

type PresetOption = {
  value: RuntimeEnvPresetId
  label: string
  description: string
}

type EndpointField = {
  key: RuntimeEnvEndpointKey
  label: string
  description: string
  placeholder: string
}

type EnvEndpointRowProps = {
  field: EndpointField
  editable: boolean
  value: string
  resolved: string
  onChange: (key: RuntimeEnvEndpointKey, value: string) => void
}

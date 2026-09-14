/** 语音输入目标的场景与主题控制，不启动真实输入能力。 */

import { Button, ButtonGroup, Input, Select, Textarea } from 'comps'
import { memo } from 'react'
import type { WindowLabPreview, WindowLabScene } from '../../types'
import type { WindowLabTargetControlsProps } from '../types'
import { applyVoiceImePreset, getVoiceImePresetId, VOICE_IME_PRESETS } from './scene'

export const VoiceImeControls = memo<WindowLabTargetControlsProps>(({ preview, onChange }) => {
  const scene = preview.scene
  const presetId = getVoiceImePresetId(preview)

  const update = (next: Partial<WindowLabPreview>) => onChange({ ...preview, ...next })
  const updateScene = (nextScene: WindowLabScene) => update({ scene: nextScene })

  return (
    <>
      <section className="mb-6">
        <div className="mb-3">
          <h2 className="text-xs font-semibold uppercase text-text2">Scene</h2>
          <p className="mt-1 text-xs leading-5 text-text3/70">Visible state only; input and network remain disconnected.</p>
        </div>
        <label className="flex flex-col gap-1.5 text-xs text-text2">
          <span className="font-medium">Preset</span>
          <Select
            options={ [
              ...(presetId === 'custom'
                ? [{ value: 'custom', label: 'Custom' }]
                : []),
              ...VOICE_IME_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
            ] }
            value={ presetId }
            onChange={ (value) => {
              const next = applyVoiceImePreset(preview, value)
              onChange(next)
            } }
            bordered
            shadowed={ false }
            className="text-xs"
          />
        </label>
      </section>

      <section className="mb-6">
        <div className="mb-3">
          <h2 className="text-xs font-semibold uppercase text-text2">Fields</h2>
          <p className="mt-1 text-xs leading-5 text-text3/70">Edit only fields used by the selected state.</p>
        </div>
        { scene.kind === 'recording' && (
          <div className="flex flex-col gap-3">
            <Field label="State">
              <Select
                options={ [
                  { value: 'listening', label: 'Listening' },
                  { value: 'transcribing', label: 'Transcribing' },
                ] }
                value={ scene.state }
                onChange={ (value) => updateScene({ ...scene, state: value as 'listening' | 'transcribing' }) }
                bordered
                shadowed={ false }
                className="text-xs"
              />
            </Field>
            <Field label="Remaining seconds">
              <Input
                type="number"
                min="0"
                max="180"
                value={ scene.remainingSeconds == null
                  ? ''
                  : String(scene.remainingSeconds) }
                placeholder="Hidden"
                onChange={ (value) =>
                  updateScene({
                    ...scene,
                    remainingSeconds: value === ''
                      ? null
                      : clamp(Number(value), 0, 180),
                  }) }
                size="sm"
                bordered
                shadowed={ false }
                className="text-xs"
              />
            </Field>
          </div>
        ) }
        { scene.kind === 'failure' && (
          <div className="flex flex-col gap-3">
            <Field label="Message">
              <Input
                value={ scene.message }
                onChange={ (value) => updateScene({ ...scene, message: value }) }
                size="sm"
                bordered
                shadowed={ false }
                className="text-xs"
              />
            </Field>
            <Field label="Detail">
              <Textarea
                value={ scene.detail ?? '' }
                onChange={ (value) => updateScene({ ...scene, detail: value || undefined }) }
                rows={ 3 }
                size="sm"
                bordered
                shadowed={ false }
                className="text-xs"
              />
            </Field>
          </div>
        ) }
        { scene.kind === 'result' && (
          <div className="flex flex-col gap-3">
            <Field label="Text">
              <Textarea
                value={ scene.text }
                onChange={ (value) => updateScene({ ...scene, text: value }) }
                rows={ 5 }
                size="sm"
                bordered
                shadowed={ false }
                className="text-xs"
              />
            </Field>
            <Field label="Source">
              <Input
                value={ scene.sourceHost ?? '' }
                onChange={ (value) => updateScene({ ...scene, sourceHost: value || undefined }) }
                size="sm"
                bordered
                shadowed={ false }
                className="text-xs"
              />
            </Field>
          </div>
        ) }
        { (scene.kind === 'prompt' || scene.kind === 'canceled') && (
          <p className="rounded-xl border border-border bg-background px-3 py-2 text-xs leading-5 text-text3">This state has no editable payload.</p>
        ) }
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-xs font-semibold uppercase text-text2">Theme</h2>
        </div>
        <ButtonGroup
          active={ preview.theme }
          onChange={ (value) => update({ theme: value as 'light' | 'dark' }) }
          rounded={ 8 }
          bordered={ false }
          className="w-full bg-background"
          aria-label="Preview theme"
        >
          <Button name="light" size="sm" className="min-w-0 flex-1 px-2 py-1.5 text-xs">Light</Button>
          <Button name="dark" size="sm" className="min-w-0 flex-1 px-2 py-1.5 text-xs">Dark</Button>
        </ButtonGroup>
      </section>
    </>
  )
})

VoiceImeControls.displayName = 'VoiceImeControls'

function Field(props: React.PropsWithChildren<{ label: string }>) {
  return (
    <label className="flex flex-col gap-1.5 text-xs text-text2">
      <span className="font-medium">{ props.label }</span>
      { props.children }
    </label>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : min
}

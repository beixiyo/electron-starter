import type { ShortcutScope } from '@shared/shortcuts'
import type { GestureType, ShortcutAction, ShortcutGestureBinding } from './types'
import { Button } from 'comps'
import { Globe2, PanelTop } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { memo } from 'react'
import { cn } from 'utils'
import { ShortcutBadge } from './ShortcutBadge'
import { formatBinding, getScopeLabel } from './types'

const GESTURE_LABEL: Record<GestureType, string> = {
  press: '单击快捷键',
  doublePress: '双击快捷键',
  hold: '长按快捷键',
}

function buildHint(supported: GestureType[]): string {
  return `按下 ${supported.map(g => GESTURE_LABEL[g]).join(' / ')}`
}

type Props = {
  action: ShortcutAction
  isRecording: boolean
  isDetected: boolean
  isUnsupported: boolean
  scope: ShortcutScope
  canUseGlobalScope: boolean
  detected: ShortcutGestureBinding | null
  onStartRecord: () => void
  onScopeChange: (scope: ShortcutScope) => void
  onConfirm: () => void
  onCancel: () => void
  onReset: () => void
}

export const ShortcutRow = memo<Props>((props) => {
  const {
    action,
    isRecording,
    isDetected,
    isUnsupported,
    scope,
    canUseGlobalScope,
    detected,
    onStartRecord,
    onScopeChange,
    onConfirm,
    onCancel,
    onReset,
  } = props

  const stateKey = isRecording
    ? 'recording'
    : isDetected
      ? 'detected'
      : isUnsupported
        ? 'unsupported'
        : 'idle'

  return (
    <div
      className={ cn(
        'group flex items-center justify-between px-5 py-4 transition-colors duration-150',
        stateKey !== 'idle' && 'bg-background2',
      ) }
    >
      <span className="text-sm text-text">{ action.label }</span>

      <div className="flex items-center gap-2">
        <AnimatePresence mode="wait">
          { stateKey === 'recording' && (
            <motion.div
              key="recording"
              className="flex items-center gap-2"
              initial={ { opacity: 0, scale: 0.92 } }
              animate={ { opacity: 1, scale: 1 } }
              exit={ { opacity: 0, scale: 0.92 } }
              transition={ { duration: 0.12 } }
            >
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-brand" />
              </span>
              <span className="text-sm text-text2">{ buildHint(action.supportedGestures) }</span>
              <ScopeSwitch
                value={ scope }
                canUseGlobalScope={ canUseGlobalScope }
                onChange={ onScopeChange }
              />
              <Button variant="ghost" size="sm" onClick={ onCancel }>取消</Button>
            </motion.div>
          ) }

          { stateKey === 'detected' && detected && (
            <motion.div
              key="detected"
              className="flex items-center gap-2"
              initial={ { opacity: 0, scale: 0.92 } }
              animate={ { opacity: 1, scale: 1 } }
              exit={ { opacity: 0, scale: 0.92 } }
              transition={ { duration: 0.12 } }
            >
              <span className="inline-flex items-center rounded-md border border-brand/30 bg-brand/10 px-2.5 py-1 font-mono text-sm text-brand">
                { formatBinding(detected) }
              </span>
              <ScopeSwitch
                value={ scope }
                canUseGlobalScope={ canUseGlobalScope }
                onChange={ onScopeChange }
              />
              <Button variant="primary" size="sm" onClick={ onConfirm }>保存</Button>
              <Button variant="ghost" size="sm" onClick={ onCancel }>取消</Button>
            </motion.div>
          ) }

          { stateKey === 'unsupported' && detected && (
            <motion.div
              key="unsupported"
              className="flex items-center gap-2"
              initial={ { opacity: 0, scale: 0.92 } }
              animate={ { opacity: 1, scale: 1 } }
              exit={ { opacity: 0, scale: 0.92 } }
              transition={ { duration: 0.12 } }
            >
              <span className="inline-flex items-center rounded-md border border-danger/30 bg-danger/10 px-2.5 py-1 font-mono text-sm text-danger line-through opacity-60">
                { formatBinding(detected) }
              </span>
              <span className="text-xs text-danger">此手势不支持</span>
              <Button variant="ghost" size="sm" onClick={ onCancel }>取消</Button>
            </motion.div>
          ) }

          { stateKey === 'idle' && (
            <motion.div
              key="idle"
              className="flex items-center gap-2"
              initial={ { opacity: 0 } }
              animate={ { opacity: 1 } }
              exit={ { opacity: 0 } }
              transition={ { duration: 0.1 } }
            >
              <button type="button" className="rounded-md focus:outline-none" onClick={ onStartRecord }>
                <ShortcutBadge binding={ action.binding } />
              </button>
              { action.binding && (
                <ScopeSwitch
                  value={ scope }
                  canUseGlobalScope={ canUseGlobalScope }
                  onChange={ onScopeChange }
                />
              ) }
              { action.binding && (
                <Button
                  variant="ghost"
                  size="sm"
                  tooltip="重置为默认"
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={ onReset }
                >
                  重置
                </Button>
              ) }
            </motion.div>
          ) }
        </AnimatePresence>
      </div>
    </div>
  )
})

ShortcutRow.displayName = 'ShortcutRow'

function ScopeSwitch(props: ScopeSwitchProps) {
  const { value, canUseGlobalScope, onChange } = props

  return (
    <div
      className="inline-flex h-7 shrink-0 items-center overflow-hidden rounded-md border border-border bg-background"
      aria-label="快捷键生效范围"
    >
      <ScopeButton
        scope="global"
        active={ value === 'global' }
        disabled={ !canUseGlobalScope }
        tooltip={ canUseGlobalScope
          ? '系统全局可触发'
          : 'Web 平台不支持系统全局快捷键' }
        onChange={ onChange }
      />
      <div className="h-3.5 w-px bg-border" />
      <ScopeButton
        scope="local"
        active={ value === 'local' }
        disabled={ false }
        tooltip="仅当前窗口聚焦时触发"
        onChange={ onChange }
      />
    </div>
  )
}

function ScopeButton(props: ScopeButtonProps) {
  const { scope, active, disabled, tooltip, onChange } = props
  const Icon = scope === 'global'
    ? Globe2
    : PanelTop

  return (
    <button
      type="button"
      className={ cn(
        'inline-flex h-full min-w-16 items-center justify-center gap-1 px-2 text-xs transition-colors',
        active
          ? 'bg-brand/10 text-brand'
          : 'text-text3 hover:bg-background2 hover:text-text',
        disabled && 'cursor-not-allowed opacity-45 hover:bg-transparent hover:text-text3',
      ) }
      title={ tooltip }
      aria-pressed={ active }
      disabled={ disabled }
      onClick={ () => onChange(scope) }
    >
      <Icon size={ 13 } aria-hidden />
      <span>{ getScopeLabel(scope) }</span>
    </button>
  )
}

type ScopeSwitchProps = {
  value: ShortcutScope
  canUseGlobalScope: boolean
  onChange: (scope: ShortcutScope) => void
}

type ScopeButtonProps = {
  scope: ShortcutScope
  active: boolean
  disabled: boolean
  tooltip: string
  onChange: (scope: ShortcutScope) => void
}

import type { ShortcutValidationCode } from '@shared/shortcuts'
import { Tooltip } from 'comps'
import { useClickOutside, useLatestCallback } from 'hooks'
import { Pencil, RotateCw, X } from 'lucide-react'
import { memo, useMemo, useRef, useState } from 'react'
import { cn } from 'utils'
import { useShortcutActionRow } from './ShortcutSettingsProvider'
import { ShortcutValue } from './ShortcutValue'

/**
 * 一条快捷键的 144×40 录制控件
 *
 * 已设置时悬停显示清除按钮，录制中显示恢复按钮，未设置时只显示编辑按钮
 * 录制到通过校验的组合会立即保存；取消通过点框外或窗口失焦完成
 */
export const ShortcutRecorder = memo<ShortcutRecorderProps>((props) => {
  const { actionId, className } = props
  const row = useShortcutActionRow(actionId)
  const boxRef = useRef<HTMLDivElement>(null)
  const boxRefs = useMemo(() => [boxRef], [])
  const [boxHovered, setBoxHovered] = useState(false)
  const [actionHovered, setActionHovered] = useState(false)

  const handleClickOutside = useLatestCallback(() => row?.cancelRecord())
  useClickOutside(boxRefs, handleClickOutside, { enabled: !!row?.isRecording })

  if (!row) return null

  const { action, ready, isRecording, active, failure, saveError } = row
  const hasBinding = !!action.binding
  const boxed = isRecording || hasBinding
  const displayedBinding = active
    ? { gesture: 'press' as const, chord: active.chord }
    : failure?.binding ?? (isRecording
      ? null
      : action.binding)
  const placeholder = !ready
    ? '加载中'
    : isRecording
    ? '输入快捷键'
    : '未设置'
  const errorText = failure
    ? VALIDATION_MESSAGES[failure.code] ?? '快捷键不可用'
    : saveError
    ? '保存失败，请重试'
    : null

  return (
    <div className={ cn('flex flex-col items-end gap-1', className) }>
      <Tooltip
        className="flex"
        placement="top"
        contentClassName="px-3 py-1.75 leading-5.25"
        visible={ !isRecording && hasBinding && boxHovered && !actionHovered }
        content="修改快捷键"
      >
        <div
          ref={ boxRef }
          className={ cn(
            'relative flex h-10 items-center gap-1 rounded-lg transition-shadow',
            boxed
              ? 'w-36 pl-3 pr-1.5 ring-1'
              : 'gap-2 pl-3',
            boxed && (errorText
              ? 'ring-danger'
              : isRecording
              ? 'ring-text'
              : 'ring-border hover:ring-text/40'),
            !ready && 'opacity-60',
          ) }
          onMouseEnter={ () => setBoxHovered(true) }
          onMouseLeave={ () => {
            setBoxHovered(false)
            setActionHovered(false)
          } }
        >
          { boxed && (
            <button
              type="button"
              aria-label={ `录制 ${action.label} 快捷键` }
              disabled={ !ready }
              className="absolute inset-0 rounded-lg focus-visible:outline-none"
              onClick={ isRecording
                ? row.cancelRecord
                : row.startRecord }
            />
          ) }

          <ShortcutValue
            binding={ displayedBinding }
            placeholder={ placeholder }
            hovered={ boxHovered }
            className={ cn(
              'pointer-events-none relative',
              boxed && 'flex-1',
              errorText
                ? 'text-danger'
                : 'text-text',
            ) }
          />

          { isRecording
            ? (
              <RecorderAction
                icon={ <RotateCw size={ 14 } aria-hidden /> }
                tooltip="恢复默认"
                disabled={ !ready }
                onHoverChange={ setActionHovered }
                onClick={ row.resetToDefault }
              />
            )
            : hasBinding
            ? (
              <RecorderAction
                icon={ <X size={ 14 } aria-hidden /> }
                tooltip="关闭快捷键"
                visible={ boxHovered }
                disabled={ !ready }
                onHoverChange={ setActionHovered }
                onClick={ row.clearBinding }
              />
            )
            : (
              <RecorderAction
                icon={ <Pencil size={ 14 } aria-hidden /> }
                tooltip="设置快捷键"
                disabled={ !ready }
                onHoverChange={ setActionHovered }
                onClick={ row.startRecord }
              />
            ) }
        </div>
      </Tooltip>

      { errorText && <span className="whitespace-nowrap text-xs leading-4.5 text-danger">{ errorText }</span> }
    </div>
  )
})

ShortcutRecorder.displayName = 'ShortcutRecorder'

const RecorderAction = memo<RecorderActionProps>((props) => {
  const { icon, tooltip, visible = true, disabled, onHoverChange, onClick } = props

  return (
    <Tooltip className="flex" placement="top" contentClassName="px-3 py-1.75 leading-5.25" content={ tooltip }>
      <button
        type="button"
        aria-label={ tooltip }
        disabled={ disabled }
        className={ cn(
          'relative grid size-6 place-items-center rounded-md text-text2 transition hover:bg-background3 focus-visible:bg-background3 focus-visible:outline-none',
          !visible && 'invisible opacity-0',
        ) }
        onMouseEnter={ () => onHoverChange(true) }
        onMouseLeave={ () => onHoverChange(false) }
        onClick={ onClick }
      >
        { icon }
      </button>
    </Tooltip>
  )
})

RecorderAction.displayName = 'RecorderAction'

const VALIDATION_MESSAGES: Record<ShortcutValidationCode, string> = {
  tooManyKeys: '组合键过多',
  alphanumericOnly: '不能只使用字母或数字',
  alreadyInUse: '快捷键已被占用',
  systemReserved: '系统保留快捷键',
}

export type ShortcutRecorderProps = {
  /** 内置快捷键动作 id；不存在时不渲染。 */
  actionId: string
  className?: string
}

type RecorderActionProps = {
  icon: React.ReactNode
  tooltip: string
  /** 是否显示图标；隐藏时保留空间，避免文本跳动。 @default true */
  visible?: boolean
  disabled?: boolean
  onHoverChange: (hovered: boolean) => void
  onClick: () => void
}

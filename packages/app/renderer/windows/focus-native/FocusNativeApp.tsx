import type { FocusPayload } from '@ipc/services/focus/contract'

import {
  FOCUS_NATIVE_ACTIONS_CONTENT_SIZE,
  FOCUS_NATIVE_CONTENT_SIZE,
  FOCUS_NATIVE_GAP,
  FOCUS_NATIVE_PANEL_CONTENT_SIZE,
  FOCUS_NATIVE_SHADOW_INSET,
  WindowType,
} from '@shared'
import { useLatestCallback, useTheme } from 'hooks'
import { ClipboardCopy, Pin, RotateCw, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { memo } from 'react'
import { cn } from 'utils'
import { useRoundedWindowHitTest, useWindowDrag } from '../shared'
import { useFocusState } from './useFocusState'

type FocusState = 'idle' | 'focused'

const actionTransition = { type: 'spring', stiffness: 400, damping: 30 } as const
const ACTION_ICON_SIZE = 14

export const FocusNativeApp = memo(() => {
  useTheme()
  const { focus } = useFocusState()
  const state: FocusState = focus?.focused
    ? 'focused'
    : 'idle'
  const contentSize = FOCUS_NATIVE_CONTENT_SIZE[state]
  const panelSize = FOCUS_NATIVE_PANEL_CONTENT_SIZE[state]
  const actionsSize = FOCUS_NATIVE_ACTIONS_CONTENT_SIZE[state]
  const panelRadius = state === 'idle'
    ? panelSize.height / 2
    : 24
  const actionsRadius = state === 'idle'
    ? actionsSize.height / 2
    : 24
  const panelY = FOCUS_NATIVE_SHADOW_INSET + (contentSize.height - panelSize.height) / 2
  const actionsX = FOCUS_NATIVE_SHADOW_INSET + panelSize.width + FOCUS_NATIVE_GAP
  const actionsY = FOCUS_NATIVE_SHADOW_INSET + (contentSize.height - actionsSize.height) / 2

  useRoundedWindowHitTest(WindowType.FOCUS_NATIVE, [
    { x: FOCUS_NATIVE_SHADOW_INSET, y: panelY, width: panelSize.width, height: panelSize.height, radius: panelRadius },
    { x: actionsX, y: actionsY, width: actionsSize.width, height: actionsSize.height, radius: actionsRadius },
  ])

  const dragHandlers = useWindowDrag(WindowType.FOCUS_NATIVE)

  const handleCopy = useLatestCallback(() => {
    if (!focus)
      return

    const payload = [
      `app=${focus.app ?? 'unknown'}`,
      `bundleId=${focus.bundleId ?? 'unknown'}`,
      `role=${focus.role ?? 'unknown'}`,
      `focused=${focus.focused}`,
    ].join('\n')
    void navigator.clipboard?.writeText(payload)
  })

  const handleHide = useLatestCallback(() => {
    void $ipc.window.hide(WindowType.FOCUS_NATIVE)
  })

  return (
    <main
      className="h-screen w-screen bg-transparent text-textPrimary"
      style={ { padding: FOCUS_NATIVE_SHADOW_INSET } }
    >
      <motion.div
        className="flex items-center"
        animate={ { width: contentSize.width, height: contentSize.height } }
        transition={ { type: 'spring', stiffness: 400, damping: 35 } }
        style={ { gap: FOCUS_NATIVE_GAP } }
      >
        <motion.section
          { ...dragHandlers }
          className={ cn(
            'relative h-full overflow-hidden bg-background text-textPrimary',
            'shadow-[0_2px_8px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]',
            'cursor-grab active:cursor-grabbing',
            state === 'idle'
              ? 'rounded-full'
              : 'rounded-[24px]',
          ) }
          animate={ { width: panelSize.width, height: panelSize.height } }
          transition={ { type: 'spring', stiffness: 400, damping: 35 } }
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(255,255,255,0.9),transparent_42%),linear-gradient(135deg,rgba(255,255,255,0.95),rgba(245,245,242,0.92))]" />

          <AnimatePresence mode="wait">
            { state === 'idle'
              ? (
                  <motion.div
                    key="idle"
                    className="relative flex h-full items-center gap-3 px-4"
                    initial={ { opacity: 0 } }
                    animate={ { opacity: 1 } }
                    exit={ { opacity: 0 } }
                    transition={ { duration: 0.18 } }
                  >
                    <span className="size-2 rounded-full bg-muted-foreground/25" />
                    <div className="flex min-w-0 flex-col justify-center gap-[3px]">
                      <p className="truncate text-[13px] font-semibold leading-[14px] text-textPrimary">
                        无文本焦点
                      </p>
                      <p className="text-[10px] uppercase leading-[11px] tracking-[0.18em] text-muted-foreground/50">
                        waiting
                      </p>
                    </div>
                  </motion.div>
                )
              : (
                  <motion.div
                    key="focused"
                    className="relative flex h-full flex-col justify-center gap-2.5 px-4 py-3"
                    initial={ { opacity: 0, y: 6 } }
                    animate={ { opacity: 1, y: 0 } }
                    exit={ { opacity: 0, y: -6 } }
                    transition={ { type: 'spring', stiffness: 400, damping: 35 } }
                  >
                    <FocusedContent focus={ focus! } />
                  </motion.div>
                ) }
          </AnimatePresence>
        </motion.section>

        <motion.section
          { ...dragHandlers }
          className={ cn(
            'relative grid shrink-0 place-items-center overflow-hidden bg-background',
            'shadow-[0_2px_8px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]',
            'cursor-grab active:cursor-grabbing',
            state === 'idle'
              ? 'grid-cols-4 rounded-full px-2 py-1'
              : 'grid-cols-2 grid-rows-2 rounded-[24px] p-2.5',
          ) }
          animate={ { width: actionsSize.width, height: actionsSize.height } }
          transition={ { type: 'spring', stiffness: 400, damping: 35 } }
          style={ { gap: state === 'focused'
            ? 8
            : 4 } }
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_0%,rgba(255,255,255,0.9),transparent_40%),linear-gradient(135deg,rgba(255,255,255,0.95),rgba(245,245,242,0.92))]" />
          <ActionButton icon={ ClipboardCopy } label="复制焦点信息" delay={ 0.02 } disabled={ !focus } onClick={ handleCopy } />
          <ActionButton icon={ Pin } label="固定" delay={ 0.04 } />
          <ActionButton icon={ RotateCw } label="刷新" delay={ 0.06 } />
          <ActionButton icon={ X } label="隐藏 native demo" delay={ 0.08 } onClick={ handleHide } />
        </motion.section>
      </motion.div>
    </main>
  )
})

FocusNativeApp.displayName = 'FocusNativeApp'

const FocusedContent = memo<{ focus: FocusPayload }>(({ focus }) => {
  const dotClass = focus.isSelf
    ? 'bg-sky-400 shadow-[0_0_6px_rgba(14,165,233,0.6)]'
    : 'bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.6)]'

  return (
    <>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={ cn('size-2 shrink-0 rounded-full animate-pulse', dotClass) } />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-[18px] text-textPrimary">
            { focus.app ?? '未知应用' }
          </p>
          <p className="mt-1 truncate text-[10px] uppercase leading-[11px] tracking-[0.28em] text-textPrimary/70">
            text focus detected
          </p>
        </div>
        { focus.isSelf && (
          <span className="shrink-0 rounded-full bg-sky-400/10 px-1.5 py-0.5 text-[10px] text-sky-400">
            本应用
          </span>
        ) }
      </div>

      <div className="flex min-w-0 items-center gap-2 pl-[18px]">
        { focus.role && (
          <span className="shrink-0 rounded-full bg-amber-400/12 px-3 py-1.5 font-mono text-[11px] leading-none text-amber-400">
            { focus.role }
          </span>
        ) }

        { focus.bundleId && (
          <span className="truncate text-[13px] font-medium leading-none text-textPrimary/85">
            { focus.bundleId }
          </span>
        ) }
      </div>
    </>
  )
})

FocusedContent.displayName = 'FocusedContent'

const ActionButton = memo<ActionButtonProps>((props) => {
  const {
    icon: Icon,
    label,
    delay,
    disabled = false,
    onClick,
  } = props

  return (
    <motion.button
      data-no-window-drag="true"
      aria-label={ label }
      title={ label }
      className={ cn(
        'relative grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground/60 transition-colors',
        'hover:bg-muted/50 hover:text-textPrimary',
        disabled && 'cursor-not-allowed opacity-35 hover:bg-transparent hover:text-muted-foreground/60',
      ) }
      disabled={ disabled }
      onClick={ onClick }
      initial={ false }
      animate={ { scale: 1 } }
      transition={ { ...actionTransition, delay } }
      type="button"
    >
      <Icon size={ ACTION_ICON_SIZE } strokeWidth={ 1.5 } />
    </motion.button>
  )
})

ActionButton.displayName = 'ActionButton'

type ActionButtonProps = {
  icon: React.ComponentType<{ size: number, strokeWidth: number }>
  label: string
  delay: number
  disabled?: boolean
  onClick?: () => void
}

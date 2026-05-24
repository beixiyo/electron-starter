import type { FocusDemoPayload } from '@ipc/services/focus-demo/contract'
import { WindowType } from '@shared'
import { FOCUS_DEMO_CONTENT_SIZE, FOCUS_DEMO_WINDOW_SIZE, SHADOW_INSET } from '@shared/window-config/constants'
import { CloseBtn } from 'comps'
import { useTheme, useUpdateEffect } from 'hooks'
import { ClipboardCopy, Pin, RotateCw } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { memo } from 'react'
import { cn } from 'utils'
import { useBarHover } from './useBarHover'
import { useFocusDemo } from './useFocusDemo'

type FocusState = 'idle' | 'focused'

const actionTransition = { type: 'spring', stiffness: 400, damping: 30 } as const
const ACTION_ICON_SIZE = 13
const IDLE_COMPACT_WIDTH = 160

export const FocusDemoApp = memo(() => {
  useTheme()
  const { focus } = useFocusDemo()
  const { ref: cardRef, isHovered } = useBarHover<HTMLDivElement>()

  const state: FocusState = focus?.focused
    ? 'focused'
    : 'idle'
  const contentSize = FOCUS_DEMO_CONTENT_SIZE[state]
  const windowSize = FOCUS_DEMO_WINDOW_SIZE[state]

  const cardWidth = state === 'idle' && !isHovered
    ? IDLE_COMPACT_WIDTH
    : contentSize.width

  useUpdateEffect(() => {
    $ipc.window.resizeTo(WindowType.FOCUS_DEMO, windowSize.width, windowSize.height, true)
  }, [state])

  return (
    <div style={ { padding: SHADOW_INSET } }>
      <motion.div
        ref={ cardRef }
        className={ cn(
          'relative overflow-hidden group',
          'bg-background rounded-2xl',
          'shadow-[0_2px_8px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]',
          '[-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]',
        ) }
        animate={ { width: cardWidth, height: contentSize.height } }
        transition={ { type: 'spring', stiffness: 400, damping: 35 } }
      >
        <AnimatePresence mode="wait">
          { state === 'idle'
            ? (
                <motion.div
                  key="idle"
                  className="absolute inset-0 flex items-center justify-between px-4"
                  initial={ { opacity: 0 } }
                  animate={ { opacity: 1 } }
                  exit={ { opacity: 0 } }
                  transition={ { duration: 0.18 } }
                >
                  <div className="flex items-center gap-2.5 pointer-events-none">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/25 flex-shrink-0" />
                    <span className="text-xs text-muted-foreground/40 tracking-wide">无文本焦点</span>
                  </div>

                  <motion.div
                    className="flex items-center gap-1 overflow-hidden"
                    initial={ false }
                    animate={ {
                      width: isHovered
                        ? 'auto'
                        : 0,
                      opacity: isHovered
                        ? 1
                        : 0,
                    } }
                    transition={ actionTransition }
                    style={ { pointerEvents: isHovered
                      ? 'auto'
                      : 'none' } }
                  >
                    <ActionButton icon={ ClipboardCopy } isHovered={ isHovered } delay={ 0.02 } />
                    <ActionButton icon={ Pin } isHovered={ isHovered } delay={ 0.05 } />
                    <ActionButton icon={ RotateCw } isHovered={ isHovered } delay={ 0.08 } />
                  </motion.div>
                </motion.div>
              )
            : (
                <motion.div
                  key="focused"
                  className="absolute inset-0 flex flex-col justify-center px-4 py-3 gap-2 pointer-events-none"
                  initial={ { opacity: 0, y: 6 } }
                  animate={ { opacity: 1, y: 0 } }
                  exit={ { opacity: 0, y: -6 } }
                  transition={ { type: 'spring', stiffness: 400, damping: 35 } }
                >
                  <FocusedContent focus={ focus! } />
                </motion.div>
              ) }
        </AnimatePresence>

        <CloseBtn
          mode="absolute"
          corner="top-right"
          size="md"
          className="opacity-0 group-hover:opacity-60 transition-opacity duration-150"
          onClick={ () => $ipc.window.hide(WindowType.FOCUS_DEMO) }
        />
      </motion.div>
    </div>
  )
})

FocusDemoApp.displayName = 'FocusDemoApp'

const FocusedContent = memo<{ focus: FocusDemoPayload }>(({ focus }) => {
  const dotClass = focus.isSelf
    ? 'bg-sky-400 shadow-[0_0_6px_rgba(14,165,233,0.6)]'
    : 'bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.6)]'

  return (
    <>
      <div className="flex items-center gap-2 pr-6">
        <span className={ cn('w-2 h-2 rounded-full flex-shrink-0 animate-pulse', dotClass) } />
        <span className="text-sm font-semibold text-textPrimary truncate flex-1">
          { focus.app ?? '未知应用' }
        </span>
        { focus.isSelf && (
          <span className="text-[10px] text-sky-400 bg-sky-400/10 px-1.5 py-0.5 rounded-full flex-shrink-0">
            本应用
          </span>
        ) }
      </div>

      { focus.bundleId && (
        <span className="text-[11px] text-muted-foreground/50 truncate leading-tight pl-[18px]">
          { focus.bundleId }
        </span>
      ) }

      { focus.role && (
        <span className="text-[10px] text-amber-400/80 bg-amber-400/10 px-1.5 py-0.5 rounded-full font-mono w-fit ml-[18px]">
          { focus.role }
        </span>
      ) }
    </>
  )
})

FocusedContent.displayName = 'FocusedContent'

const ActionButton = memo<{
  icon: React.ComponentType<{ size: number, strokeWidth: number }>
  isHovered: boolean
  delay: number
}>(({ icon: Icon, isHovered, delay }) => (
  <motion.button
    className="shrink-0 rounded-md p-1 text-muted-foreground/50 hover:text-muted-foreground/80 hover:bg-muted/50 transition-colors"
    initial={ false }
    animate={ { scale: isHovered
      ? 1
      : 0.5 } }
    transition={ { ...actionTransition, delay: isHovered
      ? delay
      : 0 } }
    type="button"
  >
    <Icon size={ ACTION_ICON_SIZE } strokeWidth={ 1.5 } />
  </motion.button>
))

ActionButton.displayName = 'ActionButton'

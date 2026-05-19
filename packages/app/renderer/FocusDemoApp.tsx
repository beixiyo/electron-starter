import type { FocusDemoPayload } from '@shared'
import { WindowType } from '@shared'
import { FOCUS_DEMO_CONTENT_SIZE, FOCUS_DEMO_WINDOW_SIZE, SHADOW_INSET } from '@shared/window-config/constants'
import { CloseBtn } from 'comps'
import { useTheme, useUpdateEffect } from 'hooks'
import { AnimatePresence, motion } from 'motion/react'
import { memo } from 'react'
import { cn } from 'utils'
import { useFocusDemo } from './useFocusDemo'

type FocusState = 'idle' | 'focused'

export const FocusDemoApp = memo(() => {
  useTheme()
  const { focus } = useFocusDemo()

  const state: FocusState = focus?.focused
    ? 'focused'
    : 'idle'
  const contentSize = FOCUS_DEMO_CONTENT_SIZE[state]
  const windowSize = FOCUS_DEMO_WINDOW_SIZE[state]

  useUpdateEffect(() => {
    $ipc.window.resizeTo(WindowType.FOCUS_DEMO, windowSize.width, windowSize.height, true)
  }, [state])

  return (
    <div style={ { padding: SHADOW_INSET } }>
      <motion.div
        className={ cn(
          'relative overflow-hidden group',
          'bg-background rounded-2xl',
          'shadow-[0_2px_8px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]',
          '[-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]',
        ) }
        animate={ { width: contentSize.width, height: contentSize.height } }
        transition={ { type: 'spring', stiffness: 400, damping: 35 } }
      >
        <AnimatePresence mode="wait">
          { state === 'idle'
            ? (
                <motion.div
                  key="idle"
                  className="absolute inset-0 flex items-center px-4 gap-2.5 pointer-events-none"
                  initial={ { opacity: 0 } }
                  animate={ { opacity: 1 } }
                  exit={ { opacity: 0 } }
                  transition={ { duration: 0.18 } }
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/25 flex-shrink-0" />
                  <span className="text-xs text-muted-foreground/40 tracking-wide">无文本焦点</span>
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

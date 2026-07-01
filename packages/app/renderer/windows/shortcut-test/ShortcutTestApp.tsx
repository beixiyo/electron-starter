import type { ShortcutTestPayload } from '@ipc/services/shortcut-test/contract'
import { WindowType } from '@shared'
import { SHADOW_INSET } from '@shared/window-config/constants'
import { CloseBtn } from 'comps'
import { useTheme } from 'hooks'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useEffect, useState } from 'react'
import { cn } from 'utils'
import {
  getInsetWindowHitTestRegion,
  getResizeHandleHitTestRegions,
  ResizeHandles,
  useRoundedWindowHitTest,
  useWindowDrag,
} from '../shared'

/** 缩放尺寸下限（含阴影留白），与窗口 config 的 minWidth/minHeight 对齐 */
const MIN_WIDTH = 280 + SHADOW_INSET * 2
const MIN_HEIGHT = 180 + SHADOW_INSET * 2

const TRIGGER_COLOR: Record<ShortcutTestPayload['triggerType'], string> = {
  hold: 'text-emerald-400',
  doublePress: 'text-sky-400',
  combo: 'text-amber-400',
  hotkey: 'text-violet-400',
}

const TRIGGER_DOT: Record<ShortcutTestPayload['triggerType'], string> = {
  hold: 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.7)]',
  doublePress: 'bg-sky-400 shadow-[0_0_8px_rgba(14,165,233,0.7)]',
  combo: 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.7)]',
  hotkey: 'bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.7)]',
}

export const ShortcutTestApp = memo(() => {
  useTheme()
  const [trigger, setTrigger] = useState<ShortcutTestPayload | null>(null)
  const dragHandlers = useWindowDrag(WindowType.SHORTCUT_TEST)

  useRoundedWindowHitTest(WindowType.SHORTCUT_TEST, () => [
    getInsetWindowHitTestRegion(SHADOW_INSET, 16),
    ...getResizeHandleHitTestRegions(SHADOW_INSET),
  ])

  useEffect(() => {
    return $ipc.shortcutTest.on('trigger', (payload) => {
      setTrigger(payload)
    })
  }, [])

  const handleClose = () => {
    setTrigger(null)
    $ipc.window.hide(WindowType.SHORTCUT_TEST)
  }

  return (
    <div
      className="relative w-screen h-screen"
      style={ { padding: SHADOW_INSET } }
    >
      {/* 实际可见的自绘容器，relative 作为 CloseBtn absolute 定位基准 */}
      <div
        { ...dragHandlers }
        className={ cn(
          'relative w-full h-full',
          'bg-background rounded-2xl',
          'shadow-[0_2px_8px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]',
          'cursor-grab active:cursor-grabbing',
        ) }
      >
        {/* 内容居中层 */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <AnimatePresence mode="wait">
            { trigger
              ? (
                  <motion.div
                    key={ `${trigger.triggerType}-${trigger.label}` }
                    className="flex flex-col items-center gap-3"
                    initial={ { opacity: 0, scale: 0.82, y: 6 } }
                    animate={ { opacity: 1, scale: 1, y: 0 } }
                    exit={ { opacity: 0, scale: 0.9, y: -4 } }
                    transition={ { type: 'spring', stiffness: 400, damping: 35 } }
                  >
                    <div className="flex items-center gap-2.5">
                      <span className={ cn('w-2 h-2 rounded-full flex-shrink-0', TRIGGER_DOT[trigger.triggerType]) } />
                      <span className={ cn('text-xl font-semibold tracking-wide', TRIGGER_COLOR[trigger.triggerType]) }>
                        { trigger.label }
                      </span>
                    </div>

                    <span className="text-[10px] text-muted-foreground/50 uppercase tracking-widest">
                      { trigger.triggerType }
                    </span>
                  </motion.div>
                )
              : (
                  <motion.div
                    key="idle"
                    className="flex items-center gap-2"
                    initial={ { opacity: 0 } }
                    animate={ { opacity: 1 } }
                    exit={ { opacity: 0 } }
                    transition={ { duration: 0.2 } }
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                    <span className="text-xs text-muted-foreground/40 tracking-wide">等待快捷键…</span>
                  </motion.div>
                ) }
          </AnimatePresence>
        </div>

        <div data-no-window-drag="true" className="absolute right-4 top-4">
          <CloseBtn
            mode="static"
            size="md"
            onClick={ handleClose }
          />
        </div>
      </div>

      {/* 四角 + 四边拖拽缩放（透明手柄，对齐可见内容边角；尺寸经主进程持久化） */}
      <ResizeHandles
        windowType={ WindowType.SHORTCUT_TEST }
        inset={ SHADOW_INSET }
        minWidth={ MIN_WIDTH }
        minHeight={ MIN_HEIGHT }
      />
    </div>
  )
})

ShortcutTestApp.displayName = 'ShortcutTestApp'

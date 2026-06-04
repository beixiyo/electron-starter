import type { ShortcutAction, ShortcutBinding } from './types'
import { Button } from 'comps'
import { AnimatePresence, motion } from 'motion/react'
import { memo } from 'react'
import { cn } from 'utils'
import { ShortcutBadge } from './ShortcutBadge'
import { formatBinding } from './types'

type Props = {
  action: ShortcutAction
  isRecording: boolean
  isDetected: boolean
  detected: ShortcutBinding | null
  onStartRecord: () => void
  onConfirm: () => void
  onCancel: () => void
  onReset: () => void
}

export const ShortcutRow = memo<Props>((props) => {
  const {
    action,
    isRecording,
    isDetected,
    detected,
    onStartRecord,
    onConfirm,
    onCancel,
    onReset,
  } = props

  const isActive = isRecording || isDetected

  return (
    <div
      className={ cn(
        'group flex items-center justify-between px-5 py-4',
        'transition-colors duration-150',
        isActive && 'bg-background2',
      ) }
    >
      <span className="text-sm text-text">{action.label}</span>

      <div className="flex items-center gap-2">
        <AnimatePresence mode="wait">
          {isRecording && (
            <motion.div
              key="recording"
              initial={ { opacity: 0, scale: 0.92 } }
              animate={ { opacity: 1, scale: 1 } }
              exit={ { opacity: 0, scale: 0.92 } }
              transition={ { duration: 0.12 } }
              className="flex items-center gap-2"
            >
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-brand" />
              </span>
              <span className="text-sm text-text2">按下 fn 组合键...</span>
              <Button variant="ghost" size="sm" onClick={ onCancel }>取消</Button>
            </motion.div>
          )}

          {isDetected && detected && (
            <motion.div
              key="detected"
              initial={ { opacity: 0, scale: 0.92 } }
              animate={ { opacity: 1, scale: 1 } }
              exit={ { opacity: 0, scale: 0.92 } }
              transition={ { duration: 0.12 } }
              className="flex items-center gap-2"
            >
              <span
                className={ cn(
                  'inline-flex items-center rounded-md px-2.5 py-1',
                  'bg-brand/10 border border-brand/30 text-sm font-mono text-brand',
                ) }
              >
                {formatBinding(detected)}
              </span>
              <Button variant="primary" size="sm" onClick={ onConfirm }>保存</Button>
              <Button variant="ghost" size="sm" onClick={ onCancel }>取消</Button>
            </motion.div>
          )}

          {!isActive && (
            <motion.div
              key="idle"
              initial={ { opacity: 0 } }
              animate={ { opacity: 1 } }
              exit={ { opacity: 0 } }
              transition={ { duration: 0.1 } }
              className="flex items-center gap-2"
            >
              <button onClick={ onStartRecord } className="rounded-md focus:outline-none">
                <ShortcutBadge binding={ action.binding } />
              </button>
              {action.binding && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={ onReset }
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  tooltip="重置为默认"
                >
                  重置
                </Button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
})

ShortcutRow.displayName = 'ShortcutRow'

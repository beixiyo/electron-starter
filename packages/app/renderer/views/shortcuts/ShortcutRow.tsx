import type { GestureType, ShortcutAction, ShortcutBinding } from './types'
import { Button } from 'comps'
import { AnimatePresence, motion } from 'motion/react'
import { memo } from 'react'
import { cn } from 'utils'
import { ShortcutBadge } from './ShortcutBadge'
import { formatBinding } from './types'

const GESTURE_LABEL: Record<GestureType, string> = {
  combo: 'fn 组合键',
  doublePress: '双击 fn',
  hold: '长按 fn',
  hotkey: '⌘⌃⌥ 快捷键',
}

function buildHint(supported: GestureType[]): string {
  return `按下 ${supported.map(g => GESTURE_LABEL[g]).join(' / ')}`
}

type Props = {
  action: ShortcutAction
  isRecording: boolean
  isDetected: boolean
  isUnsupported: boolean
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
    isUnsupported,
    detected,
    onStartRecord,
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

import { WindowType } from '@shared'
import { SHADOW_INSET, SHORTCUT_TEST_WINDOW_SIZE } from '@shared/window-config/metrics'
import { Button, CloseBtn } from 'comps'
import { useLatestCallback, useTheme } from 'hooks'
import { Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useEffect, useRef, useState } from 'react'
import { cn } from 'utils'
import {
  getInsetWindowHitTestRegion,
  getResizeHandleHitTestRegions,
  ResizeHandles,
  useRoundedWindowHitTest,
  useWindowDrag,
} from '../shared'

/** 缩放尺寸下限（含阴影留白），与窗口 config 的 minWidth/minHeight 对齐 */
const MIN_WIDTH = SHORTCUT_TEST_WINDOW_SIZE.width
const MIN_HEIGHT = SHORTCUT_TEST_WINDOW_SIZE.height
const LONG_PRESS_THRESHOLD_MS = 300
const HOLD_CLOCK_INTERVAL_MS = 80

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

const MODIFIER_LABEL: Record<ModifierKey, string> = {
  meta: '⌘',
  control: 'Ctrl',
  alt: '⌥',
  shift: 'Shift',
}

const MODIFIER_ORDER: Record<ModifierKey, number> = {
  meta: 0,
  control: 1,
  alt: 2,
  shift: 3,
}

export const ShortcutTestApp = memo<ShortcutTestAppProps>((props) => {
  const { initialTrigger = null } = props
  useTheme()
  const [trigger, setTrigger] = useState<ShortcutTestPayload | null>(initialTrigger)
  const [pressedKeys, setPressedKeys] = useState<PressedKey[]>([])
  const [lastShortcut, setLastShortcut] = useState<string | null>(null)
  const [clockNow, setClockNow] = useState(() => Date.now())
  const pressedKeysRef = useRef<PressedKey[]>([])
  const dragHandlers = useWindowDrag(WindowType.SHORTCUT_TEST)
  const currentShortcut = formatPressedShortcut(pressedKeys)
  const hasPressedKeys = pressedKeys.length > 0
  const heldKeys = getHeldKeys(pressedKeys, clockNow)
  const heldShortcut = formatPressedShortcut(heldKeys)
  const holdDurationMs = getHoldDurationMs(heldKeys, clockNow)
  const holdReadout = heldShortcut
    ? `${heldShortcut} · ${formatDuration(holdDurationMs)}`
    : trigger?.triggerType === 'hold'
      ? trigger.label
      : '无'
  const hasHoldReadout = !!heldShortcut || trigger?.triggerType === 'hold'

  useRoundedWindowHitTest(WindowType.SHORTCUT_TEST, () => [
    getInsetWindowHitTestRegion(SHADOW_INSET, 16),
    ...getResizeHandleHitTestRegions(SHADOW_INSET),
  ])

  const setPressedSnapshot = useLatestCallback((nextPressedKeys: PressedKey[]) => {
    pressedKeysRef.current = nextPressedKeys
    setPressedKeys(nextPressedKeys)
  })

  const clearPressedSnapshot = useLatestCallback(() => {
    setPressedSnapshot([])
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const now = Date.now()
      const nextPressedKeys = upsertPressedKey(pressedKeysRef.current, toPressedKey(event, now))
      setPressedSnapshot(nextPressedKeys)
      setClockNow(now)
      setLastShortcut(formatPressedShortcut(nextPressedKeys))
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      setClockNow(Date.now())

      if (isMetaKey(event)) {
        clearPressedSnapshot()
        return
      }

      setPressedSnapshot(removePressedKey(pressedKeysRef.current, getPressedKeyId(event)))
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', clearPressedSnapshot)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', clearPressedSnapshot)
    }
  }, [clearPressedSnapshot, setPressedSnapshot])

  useEffect(() => {
    if (!hasPressedKeys)
      return

    const timer = setInterval(() => {
      setClockNow(Date.now())
    }, HOLD_CLOCK_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [hasPressedKeys])

  const handleClear = useLatestCallback(() => {
    setTrigger(null)
    setLastShortcut(null)
    setClockNow(Date.now())
    clearPressedSnapshot()
  })

  const handleClose = useLatestCallback(() => {
    handleClear()
    $ipc.window.hide(WindowType.SHORTCUT_TEST)
  })

  return (
    <div
      className="relative w-screen h-screen"
      style={ { padding: SHADOW_INSET } }
    >
      {/* 实际可见的自绘容器，relative 作为 CloseBtn absolute 定位基准 */}
      <div
        { ...dragHandlers }
        className={ cn(
          'relative flex h-full w-full min-h-0 flex-col',
          'bg-background rounded-2xl',
          'shadow-[0_2px_8px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]',
          'overflow-hidden cursor-grab active:cursor-grabbing',
        ) }
      >
        <div className="flex h-full min-h-0 flex-col px-4 py-4">
          <div className="z-10 flex h-8 shrink-0 items-center justify-between gap-3" data-no-window-drag="true">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              leftIcon={ <Trash2 size={ 13 } /> }
              onClick={ handleClear }
            >
              清空
            </Button>

            <CloseBtn
              mode="static"
              size={ 28 }
              onClick={ handleClose }
            />
          </div>

          <div className="pointer-events-none flex min-h-0 flex-1 items-center justify-center px-2 py-5">
            <div className="flex min-h-[116px] w-full items-center justify-center">
              <AnimatePresence mode="wait">
                { trigger
                  ? (
                      <motion.div
                        key={ `${trigger.triggerType}-${trigger.label}` }
                        className="flex min-w-0 max-w-full flex-col items-center gap-2.5"
                        initial={ { opacity: 0, scale: 0.82, y: 6 } }
                        animate={ { opacity: 1, scale: 1, y: 0 } }
                        exit={ { opacity: 0, scale: 0.9, y: -4 } }
                        transition={ { type: 'spring', stiffness: 400, damping: 35 } }
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className={ cn('size-2 rounded-full flex-shrink-0', TRIGGER_DOT[trigger.triggerType]) } />
                          <span className={ cn('min-w-0 truncate text-[19px] font-semibold', TRIGGER_COLOR[trigger.triggerType]) }>
                            { trigger.label }
                          </span>
                        </div>

                        <span className="text-[10px] uppercase text-muted-foreground/50">
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
                        <span className="size-1.5 rounded-full bg-muted-foreground/30" />
                        <span className="text-xs text-muted-foreground/40">等待快捷键...</span>
                      </motion.div>
                    ) }
              </AnimatePresence>
            </div>
          </div>

          <div className="grid shrink-0 gap-2">
            <ShortcutReadout
              label="当前按下"
              value={ currentShortcut ?? '无' }
              active={ hasPressedKeys }
            />

            <ShortcutReadout
              label="最近输入"
              value={ lastShortcut ?? '无' }
              active={ !!lastShortcut }
            />

            <ShortcutReadout
              label="长按"
              value={ holdReadout }
              active={ hasHoldReadout }
            />
          </div>
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

const ShortcutReadout = memo<ShortcutReadoutProps>((props) => {
  const { label, value, active } = props

  return (
    <div className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-background2/70 px-2.5">
      <span className="w-16 shrink-0 text-[10px] text-muted-foreground/50">
        { label }
      </span>

      <span
        className={ cn(
          'min-w-0 flex-1 truncate font-mono text-xs font-medium',
          active
            ? 'text-textPrimary'
            : 'text-muted-foreground/40',
        ) }
      >
        { value }
      </span>
    </div>
  )
})

ShortcutReadout.displayName = 'ShortcutReadout'

function upsertPressedKey(pressedKeys: PressedKey[], nextPressedKey: PressedKey) {
  const existingKey = pressedKeys.find(pressedKey => pressedKey.id === nextPressedKey.id)

  return sortPressedKeys([
    ...pressedKeys.filter(pressedKey => pressedKey.id !== nextPressedKey.id),
    existingKey
      ? { ...nextPressedKey, pressedAt: existingKey.pressedAt }
      : nextPressedKey,
  ])
}

function removePressedKey(pressedKeys: PressedKey[], id: string) {
  return pressedKeys.filter(pressedKey => pressedKey.id !== id)
}

function sortPressedKeys(pressedKeys: PressedKey[]) {
  return [...pressedKeys].sort((a, b) => {
    const orderDiff = getPressedKeyOrder(a) - getPressedKeyOrder(b)

    if (orderDiff)
      return orderDiff

    const labelDiff = a.label.localeCompare(b.label)

    if (labelDiff)
      return labelDiff

    return a.id.localeCompare(b.id)
  })
}

function getPressedKeyOrder(pressedKey: PressedKey) {
  if (pressedKey.modifier)
    return MODIFIER_ORDER[pressedKey.modifier]

  return 10
}

function formatPressedShortcut(pressedKeys: PressedKey[]) {
  if (!pressedKeys.length)
    return null

  return sortPressedKeys(pressedKeys)
    .map(pressedKey => pressedKey.label)
    .join(' + ')
}

function getHeldKeys(pressedKeys: PressedKey[], now: number) {
  return pressedKeys.filter(pressedKey => now - pressedKey.pressedAt >= LONG_PRESS_THRESHOLD_MS)
}

function getHoldDurationMs(pressedKeys: PressedKey[], now: number) {
  if (!pressedKeys.length)
    return 0

  const firstPressedAt = Math.min(...pressedKeys.map(pressedKey => pressedKey.pressedAt))
  return Math.max(now - firstPressedAt, 0)
}

function formatDuration(durationMs: number) {
  return `${(durationMs / 1000).toFixed(1)}s`
}

function toPressedKey(event: KeyboardEvent, pressedAt: number): PressedKey {
  const modifier = getModifierKey(event)

  return {
    id: getPressedKeyId(event),
    pressedAt,
    label: modifier
      ? MODIFIER_LABEL[modifier]
      : getKeyLabel(event),
    modifier,
  }
}

function getPressedKeyId(event: KeyboardEvent) {
  return event.code || event.key || 'Unidentified'
}

function getModifierKey(event: KeyboardEvent): ModifierKey | null {
  if (event.key === 'Meta' || event.code.startsWith('Meta'))
    return 'meta'

  if (event.key === 'Control' || event.code.startsWith('Control'))
    return 'control'

  if (event.key === 'Alt' || event.code.startsWith('Alt'))
    return 'alt'

  if (event.key === 'Shift' || event.code.startsWith('Shift'))
    return 'shift'

  return null
}

function isMetaKey(event: KeyboardEvent) {
  return event.key === 'Meta' || event.code.startsWith('Meta')
}

function getKeyLabel(event: KeyboardEvent) {
  const knownLabel = getKnownKeyLabel(event)

  if (knownLabel)
    return knownLabel

  if (event.code.startsWith('Key'))
    return event.code.slice(3).toUpperCase()

  if (event.code.startsWith('Digit'))
    return event.code.slice(5)

  if (event.code.startsWith('Numpad'))
    return `Num ${event.code.slice(6)}`

  if (event.key.length === 1)
    return event.key.toUpperCase()

  return event.key || event.code || 'Unknown'
}

function getKnownKeyLabel(event: KeyboardEvent) {
  const codeLabel: Record<string, string> = {
    Space: 'Space',
    Tab: 'Tab',
    Enter: 'Enter',
    Escape: 'Esc',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  }

  return codeLabel[event.code] ?? codeLabel[event.key]
}

/**
 * Shortcut Test 窗口初始触发数据
 */
export type ShortcutTestPayload = {
  /** 触发类型 */
  triggerType: 'hold' | 'doublePress' | 'combo' | 'hotkey'
  /** 显示文本，如 "Hold Triggered" / "Combo: Space" */
  label: string
}

/** Shortcut Test 窗口参数 */
export type ShortcutTestAppProps = {
  /**
   * 初始触发数据
   *
   * @default null
   */
  initialTrigger?: ShortcutTestPayload | null
}

type ShortcutReadoutProps = {
  label: string
  value: string
  active: boolean
}

type PressedKey = {
  id: string
  pressedAt: number
  label: string
  modifier: ModifierKey | null
}

type ModifierKey = 'meta' | 'control' | 'alt' | 'shift'

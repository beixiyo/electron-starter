import type {
  ShortcutChord,
  ShortcutGestureBinding,
  ShortcutGestureType,
  ShortcutRecordEvent,
} from './types'
import { isKeyboardModifierChordPrefixOf, shortcutChordsEqual } from './utils'

const DEFAULT_DOUBLE_PRESS_INTERVAL_MS = 300
const DEFAULT_HOLD_MIN_DURATION_MS = 400
const DEFAULT_UNSUPPORTED_RESET_MS = 1500

/** 创建快捷键录制状态机，消费标准化输入事件并输出最终 binding */
export function createShortcutRecordEngine(
  options: CreateShortcutRecordEngineOptions,
): ShortcutRecordEngine {
  const {
    onDetectedChange,
    onPhaseChange,
    doublePressIntervalMs = DEFAULT_DOUBLE_PRESS_INTERVAL_MS,
    holdMinDurationMs = DEFAULT_HOLD_MIN_DURATION_MS,
    unsupportedResetMs = DEFAULT_UNSUPPORTED_RESET_MS,
  } = options

  let phase: ShortcutRecordDetectionPhase = 'idle'
  let supportedGestures: readonly ShortcutGestureType[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let activeChord: ShortcutChord | null = null
  let activeStartedAt = 0
  let pendingChord: ShortcutChord | null = null
  let holdDetected = false
  let completesDoublePress = false

  const start = (nextSupportedGestures: readonly ShortcutGestureType[]): void => {
    clearRecordState()
    supportedGestures = nextSupportedGestures
    onDetectedChange(null)
    setPhase('waiting')
  }

  const cancel = (): void => {
    clearRecordState()
    supportedGestures = []
    onDetectedChange(null)
    setPhase('idle')
  }

  const reset = (): void => {
    clearRecordState()
    onDetectedChange(null)
    if (phase !== 'idle')
      setPhase('waiting')
  }

  const handle = (event: ShortcutRecordEvent): void => {
    if (event.phase === 'press') {
      handleInstantPress(event.chord)
      return
    }

    if (event.phase === 'down') {
      handleShortcutDown(event.chord, event.timestamp)
      return
    }

    handleShortcutUp(event.chord, event.timestamp)
  }

  const handleShortcutDown = (chord: ShortcutChord, timestamp: number): void => {
    if (!canAcceptInput())
      return
    if (activeChord) {
      if (!isKeyboardModifierChordPrefixOf(activeChord, chord))
        return

      clearTimer()
      clearActiveChord()
    }

    const isSecondPress = canFinishDoublePress(chord)

    clearTimer()
    pendingChord = null
    activeChord = chord
    activeStartedAt = timestamp
    holdDetected = false
    completesDoublePress = isSecondPress
    setPhase('deciding')

    if (!hasGesture('hold'))
      return

    timer = setTimeout(() => {
      timer = null
      if (!activeChord || !shortcutChordsEqual(activeChord, chord))
        return

      holdDetected = true
      detect({
        gesture: 'hold',
        chord,
        minDurationMs: holdMinDurationMs,
      })
    }, holdMinDurationMs)
  }

  const handleShortcutUp = (chord: ShortcutChord, timestamp: number): void => {
    if (!activeChord || !shortcutChordsEqual(activeChord, chord))
      return

    const startedAt = activeStartedAt
    const wasHoldDetected = holdDetected
    const wasCompletingDoublePress = completesDoublePress
    clearTimer()
    clearActiveChord()

    if (wasHoldDetected)
      return

    if (wasCompletingDoublePress) {
      detect({
        gesture: 'doublePress',
        chord,
        intervalMs: doublePressIntervalMs,
      })
      return
    }

    const elapsed = Math.max(timestamp - startedAt, 0)
    if (hasGesture('hold') && elapsed >= holdMinDurationMs) {
      detect({
        gesture: 'hold',
        chord,
        minDurationMs: holdMinDurationMs,
      })
      return
    }

    finishShortPress(chord)
  }

  const handleInstantPress = (chord: ShortcutChord): void => {
    if (!canAcceptInput())
      return

    if (canFinishDoublePress(chord)) {
      detect({
        gesture: 'doublePress',
        chord,
        intervalMs: doublePressIntervalMs,
      })
      return
    }

    clearActiveChord()
    finishShortPress(chord)
  }

  const finishShortPress = (chord: ShortcutChord): void => {
    const canPress = hasGesture('press')
    const canDoublePress = hasGesture('doublePress')

    if (canDoublePress) {
      clearTimer()
      pendingChord = chord
      setPhase('wait_double')
      timer = setTimeout(() => {
        timer = null
        pendingChord = null

        if (canPress) {
          detect({ gesture: 'press', chord })
        }
        else if (phase === 'wait_double') {
          setPhase('waiting')
        }
      }, doublePressIntervalMs)
      return
    }

    detect({ gesture: 'press', chord })
  }

  const detect = (binding: ShortcutGestureBinding): void => {
    clearRecordState()
    onDetectedChange(binding)

    if (supportedGestures.includes(binding.gesture)) {
      setPhase('detected')
      return
    }

    setPhase('unsupported')
    timer = setTimeout(() => {
      timer = null
      if (phase === 'unsupported') {
        onDetectedChange(null)
        setPhase('waiting')
      }
    }, unsupportedResetMs)
  }

  const canFinishDoublePress = (chord: ShortcutChord): boolean => {
    return hasGesture('doublePress')
      && !!pendingChord
      && shortcutChordsEqual(pendingChord, chord)
  }

  const canAcceptInput = (): boolean => {
    return phase === 'waiting'
      || phase === 'deciding'
      || phase === 'wait_double'
  }

  const hasGesture = (gesture: ShortcutGestureType): boolean => {
    return supportedGestures.includes(gesture)
  }

  const clearRecordState = (): void => {
    clearTimer()
    clearActiveChord()
    pendingChord = null
  }

  const clearActiveChord = (): void => {
    activeChord = null
    activeStartedAt = 0
    holdDetected = false
    completesDoublePress = false
  }

  const clearTimer = (): void => {
    if (!timer)
      return

    clearTimeout(timer)
    timer = null
  }

  const setPhase = (nextPhase: ShortcutRecordDetectionPhase): void => {
    phase = nextPhase
    onPhaseChange(nextPhase)
  }

  return {
    get phase() {
      return phase
    },
    start,
    cancel,
    reset,
    handle,
    dispose() {
      clearRecordState()
      supportedGestures = []
    },
  }
}

/** 快捷键录制 UI 阶段 */
export type ShortcutRecordDetectionPhase = 'idle' | 'waiting' | 'deciding' | 'wait_double' | 'detected' | 'unsupported'

export type CreateShortcutRecordEngineOptions = {
  /** 状态机阶段变化回调 */
  onPhaseChange: (phase: ShortcutRecordDetectionPhase) => void
  /** 录制结果变化回调；null 表示清空当前结果 */
  onDetectedChange: (binding: ShortcutGestureBinding | null) => void
  /** @default 300 */
  doublePressIntervalMs?: number
  /** @default 400 */
  holdMinDurationMs?: number
  /** @default 1500 */
  unsupportedResetMs?: number
}

export type ShortcutRecordEngine = {
  /** 当前录制阶段 */
  readonly phase: ShortcutRecordDetectionPhase
  /** 开始一轮录制 */
  start: (supportedGestures: readonly ShortcutGestureType[]) => void
  /** 取消录制并清空内部状态 */
  cancel: () => void
  /** 输入源重置后清空本轮物理状态，并继续等待录制 */
  reset: () => void
  /** 消费一个标准化录制事件 */
  handle: (event: ShortcutRecordEvent) => void
  /** 释放 timer 和内部状态 */
  dispose: () => void
}
